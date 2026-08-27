package clock

import (
	"fmt"
	"sync"
	"time"
)

// Fake is a Clock whose time only moves when a test calls Advance.
//
// It is safe to use from two goroutines at once, which is the whole point: a
// phase test calls Advance from the test goroutine while the game runs in its
// own. That makes this the one type in the backend deliberately exempt from the
// single-goroutine ownership invariant.
//
// Advance one phase at a time. Firing a timer lets the code under test create
// the next phase's timer, but Advance only proves the value was received, not
// that the handler finished registering what comes next. Advance(8s) then
// Advance(30s) is reliable; Advance(38s) can re-scan before the second timer
// exists and silently step past it.
type Fake struct {
	mu      sync.Mutex
	now     time.Time
	seq     uint64
	pending []*fakeTimer
}

// NewFake returns a Fake started at the given instant. A zero start is fine;
// tests that print timestamps usually want a recognisable one.
func NewFake(start time.Time) *Fake { return &Fake{now: start} }

// fakeTimer is one pending deadline. Every field is guarded by Fake.mu except
// ch, which is safe to send on without the lock and must be, since the receiver
// calls Now.
type fakeTimer struct {
	f        *Fake
	deadline time.Time
	seq      uint64
	ch       chan time.Time
	stopped  bool
}

// Now reports the current virtual time, which only Advance ever moves.
func (f *Fake) Now() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.now
}

// NewTimer schedules a deadline d from the current virtual now and registers it
// as pending, so the next Advance that reaches it will fire it.
func (f *Fake) NewTimer(d time.Duration) Timer {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.seq++
	t := &fakeTimer{
		f:        f,
		deadline: f.now.Add(d),
		seq:      f.seq,
		// Buffered, size 1, exactly like time.Timer: a fire with the buffer
		// full is dropped rather than blocked.
		ch: make(chan time.Time, 1),
	}
	f.pending = append(f.pending, t)
	return t
}

// After is sugar over NewTimer so there is one scheduling path rather than two.
// Like time.After, the timer is not collected until it fires.
func (f *Fake) After(d time.Duration) <-chan time.Time { return f.NewTimer(d).C() }

// Advance moves virtual time forward by d, firing every timer that comes due
// and waiting for each to be received before continuing.
//
// It walks to each deadline in turn rather than jumping to the end, so a
// handler reading Now when its timer fires observes the deadline itself. Phase
// events carry their timestamps from Now, so a fake that jumped straight to the
// target would produce self-inconsistent times that read like a game bug.
func (f *Fake) Advance(d time.Duration) { f.advance(d, true) }

// AdvanceNoWait fires without waiting for receipt, for the rare test that
// deliberately observes a mid-flight state.
func (f *Fake) AdvanceNoWait(d time.Duration) { f.advance(d, false) }

// advance is the shared body of Advance and AdvanceNoWait: it steps virtual time
// to each due deadline in turn, firing and removing one timer per iteration. The
// lock is released before every fire, because the receiving goroutine calls Now.
func (f *Fake) advance(d time.Duration, wait bool) {
	if d < 0 {
		panic("clock: Advance with a negative duration; time does not run backwards")
	}

	f.mu.Lock()
	target := f.now.Add(d)
	f.mu.Unlock()

	for {
		f.mu.Lock()
		t := f.earliestDue(target)
		if t == nil {
			f.now = target
			f.mu.Unlock()
			return
		}
		// Only ever forward: a timer created with a non-positive duration, or
		// one whose deadline is already behind us, must not rewind the clock.
		if t.deadline.After(f.now) {
			f.now = t.deadline
		}
		f.remove(t)
		f.mu.Unlock() // before firing: the receiving goroutine calls Now

		fire(t)
		if wait {
			waitDrained(t)
		}
	}
}

// earliestDue returns the pending timer with the smallest deadline at or before
// target, breaking ties on insertion order. Nil when nothing is due.
//
// Ties are constant in practice: every player's turn timer starts on the same
// phase transition. Without the seq tie-break their order would be whatever the
// slice happened to hold.
//
// Caller must hold f.mu.
func (f *Fake) earliestDue(target time.Time) *fakeTimer {
	var best *fakeTimer
	for _, p := range f.pending {
		if p.deadline.After(target) {
			continue
		}
		switch {
		case best == nil:
			best = p
		case p.deadline.Before(best.deadline):
			best = p
		case p.deadline.Equal(best.deadline) && p.seq < best.seq:
			best = p
		}
	}
	return best
}

// lookup finds t in pending by identity. Caller must hold f.mu.
func (f *Fake) lookup(t *fakeTimer) (bool, int) {
	for idx, p := range f.pending {
		if p == t {
			return true, idx
		}
	}
	return false, -1
}

// remove drops t from pending. It is a no-op when t is not pending, so Stop and
// advance can both call it without checking first. Caller must hold f.mu.
func (f *Fake) remove(t *fakeTimer) {
	found, idx := f.lookup(t)
	if !found {
		return
	}
	// Clear the vacated tail slot so the removed timer is not kept alive by the
	// backing array.
	copy(f.pending[idx:], f.pending[idx+1:])
	f.pending[len(f.pending)-1] = nil
	f.pending = f.pending[:len(f.pending)-1]
}

// fire delivers the deadline, dropping it when the buffer is already full.
//
// The default case is what makes an abandoned timer a failed test rather than a
// hung one, and it matches time.Timer, which does the same.
func fire(t *fakeTimer) {
	select {
	case t.ch <- t.deadline:
	default:
	}
}

// drainBudget is real wall-clock time, not virtual. Generous enough that a
// loaded CI machine never trips it, short enough that a genuinely stuck test
// fails rather than hanging until the go test timeout.
//
// A var rather than a const so the test covering the panic can lower it, instead
// of costing two real seconds to prove a message.
var drainBudget = 2 * time.Second

// drainStale discards a value that fire delivered but nobody took.
//
// Go 1.23 made time.Timer's channel unbuffered precisely so that Stop and Reset
// guarantee no stale value arrives afterwards. Matching that matters more here
// than it looks: a phase that ends early stops its deadline, and a stale value
// left behind would be waiting in the next select to end the following phase
// instantly. Real time cannot produce that; without this, the fake could.
//
// Caller must hold Fake.mu.
func drainStale(ch chan time.Time) {
	select {
	case <-ch:
	default:
	}
}

// waitDrained blocks until the value fire delivered has been received.
//
// A buffered send returns immediately, so receipt is not directly observable;
// len on a buffered channel is exactly the question "is the value still sitting
// there". The sleep below is the one real sleep in this package: it waits for a
// goroutine to be scheduled, not for game time to pass, so replacing it with
// virtual time would be wrong.
func waitDrained(t *fakeTimer) {
	giveUp := time.Now().Add(drainBudget)
	backoff := 10 * time.Microsecond

	for len(t.ch) > 0 {
		if time.Now().After(giveUp) {
			panic(fmt.Sprintf(
				"clock: timer due at %s fired but nothing received it within %s; "+
					"either the timer was abandoned without Stop, or the goroutine "+
					"under test is blocked",
				t.deadline, drainBudget))
		}
		time.Sleep(backoff)
		backoff = min(backoff*2, time.Millisecond)
	}
}

// C returns the channel the deadline is delivered on. It is buffered with room
// for one, so a fire with an unread value already waiting is dropped.
func (t *fakeTimer) C() <-chan time.Time { return t.ch }

// Stop reports whether it stopped a timer that had not yet fired, matching
// time.Timer.
//
// The stopped flag is what separates "already stopped" from "already fired":
// both leave the timer absent from pending, and only the flag can tell them
// apart on a second call.
//
// This is also what keeps Advance from tripping its drain budget on the common
// path. A phase that ends early stops its deadline, so the timer never fires
// and nothing waits for a receiver that will never come.
func (t *fakeTimer) Stop() bool {
	t.f.mu.Lock()
	defer t.f.mu.Unlock()

	// Unconditionally, including on the paths that return false: the whole point
	// is that nothing stale survives a Stop, and the already-fired path is
	// exactly where a stale value would be.
	drainStale(t.ch)

	if t.stopped {
		return false
	}
	found, _ := t.f.lookup(t)
	if !found {
		return false // already fired
	}
	t.f.remove(t)
	t.stopped = true
	return true
}

// Reset reschedules t to fire d from the current virtual now, reporting whether
// it was still pending, matching time.Timer.
//
// The new deadline is computed from now, never from the old deadline.
func (t *fakeTimer) Reset(d time.Duration) bool {
	t.f.mu.Lock()
	defer t.f.mu.Unlock()

	wasPending, _ := t.f.lookup(t)

	// Same guarantee as Stop: the rescheduled timer must not deliver the
	// deadline it had before the Reset.
	drainStale(t.ch)

	t.deadline = t.f.now.Add(d)
	t.stopped = false
	if !wasPending {
		t.f.seq++
		t.seq = t.f.seq
		t.f.pending = append(t.f.pending, t)
	}
	return wasPending
}
