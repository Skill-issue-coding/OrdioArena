package clock

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

// epoch is an arbitrary but recognisable start for the fake, so a failure
// message reads as a date rather than as year one.
var epoch = time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

// harness drives one clock implementation through the conformance table.
//
// step is the bridge that lets one table drive both clocks: on the fake it is
// Advance, on the real one it is a plain sleep. setup hands back a fresh clock
// per subtest, so one row can never leave state behind for the next.
type harness struct {
	name  string
	d     time.Duration
	setup func() (clk Clock, step, stepNoWait func(time.Duration))
}

// didFire reports whether a value is waiting on the timer's channel.
//
// A non-blocking receive rather than len: since Go 1.23 a real timer's channel
// has capacity zero and reports len 0 even holding a fired value, so every len
// assertion would pass vacuously against the real clock.
func didFire(tm Timer) bool {
	select {
	case <-tm.C():
		return true
	default:
		return false
	}
}

// queued counts how many values a timer has waiting, draining them.
func queued(tm Timer) int {
	n := 0
	for didFire(tm) {
		n++
	}
	return n
}

// next takes the next value from ch, failing the test rather than blocking when
// it never arrives.
//
// A timer that fires at the wrong deadline leaves its receiver waiting forever,
// and a bare receive would turn that into a hang reported at the go test
// timeout, naming no assertion at all. This turns the same bug into a failure.
func next[T any](t *testing.T, ch <-chan T) T {
	t.Helper()
	select {
	case v := <-ch:
		return v
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for a timer to fire")
		var zero T
		return zero
	}
}

// harnesses returns the table's two subjects.
//
// The durations differ by three orders of magnitude on purpose: the fake pays
// nothing for a realistic phase deadline, while every millisecond the real clock
// is given is a millisecond of test suite.
func harnesses() []harness {
	return []harness{
		{
			name: "real",
			d:    5 * time.Millisecond,
			setup: func() (Clock, func(time.Duration), func(time.Duration)) {
				// A real timer fires at or slightly after its deadline, so the
				// step has to overshoot it. Real time has no notion of waiting
				// for receipt, so both steps are the same sleep.
				sleep := func(d time.Duration) { time.Sleep(d + 20*time.Millisecond) }
				return Real(), sleep, sleep
			},
		},
		{
			name: "fake",
			d:    8 * time.Second,
			setup: func() (Clock, func(time.Duration), func(time.Duration)) {
				f := NewFake(epoch)
				return f, f.Advance, f.AdvanceNoWait
			},
		},
	}
}

// Both implementations must satisfy both interfaces. Cheaper than a test, and
// it fails at build rather than at run.
var (
	_ Clock = (*Fake)(nil)
	_ Clock = realClock{}
	_ Timer = (*fakeTimer)(nil)
	_ Timer = realTimer{}
)

// TestConformance runs one set of assertions against both implementations.
//
// It is not really testing either clock. Code is written against the fake and
// ships against the real one, so the point is that the two cannot drift: a
// divergence in what Stop returns, or in whether a fire blocks, is a bug that
// would otherwise show up in exactly one of the two environments.
func TestConformance(t *testing.T) {
	t.Parallel()

	for _, h := range harnesses() {
		t.Run(h.name, func(t *testing.T) {
			t.Parallel()

			t.Run("fires once", func(t *testing.T) {
				t.Parallel()
				clk, step, _ := h.setup()
				tm := clk.NewTimer(h.d)

				// The receiver has to be in flight before the step: the fake's
				// Advance blocks until the value is taken, so receiving after it
				// returned would deadlock rather than pass.
				got := make(chan time.Time, 1)
				go func() { got <- <-tm.C() }()

				step(h.d)

				select {
				case <-got:
				case <-time.After(time.Second):
					t.Fatal("timer did not fire")
				}

				// One-shot: stepping again must not produce a second value.
				step(h.d)
				if didFire(tm) {
					t.Error("a one-shot timer fired twice")
				}
			})

			t.Run("stop pending returns true, no fire", func(t *testing.T) {
				t.Parallel()
				clk, step, _ := h.setup()
				tm := clk.NewTimer(h.d)

				if !tm.Stop() {
					t.Error("Stop on a pending timer = false, want true")
				}

				// No receiver, and that is itself part of the assertion: a
				// stopped timer never fires, so nothing waits for one.
				step(h.d)

				if didFire(tm) {
					t.Error("a stopped timer fired")
				}
			})

			t.Run("stop after fire returns false", func(t *testing.T) {
				t.Parallel()
				clk, step, _ := h.setup()
				tm := clk.NewTimer(h.d)

				go func() { <-tm.C() }() // the fake needs a receiver or Advance blocks
				step(h.d)

				if tm.Stop() {
					t.Error("Stop after the timer fired = true, want false")
				}
			})

			t.Run("stop twice returns false", func(t *testing.T) {
				t.Parallel()
				clk, _, _ := h.setup()
				tm := clk.NewTimer(h.d)

				// Deliberately never fired: this is the stopped-then-stopped
				// path, which is the only thing separating it from the row
				// above. Letting it fire first would test that one twice.
				if !tm.Stop() {
					t.Error("first Stop on a pending timer = false, want true")
				}
				if tm.Stop() {
					t.Error("second Stop = true, want false")
				}
			})

			t.Run("reset while pending returns true", func(t *testing.T) {
				t.Parallel()
				clk, _, _ := h.setup()
				tm := clk.NewTimer(h.d)

				if !tm.Reset(h.d) {
					t.Error("Reset on a pending timer = false, want true")
				}
			})

			t.Run("reset after fire returns false", func(t *testing.T) {
				t.Parallel()
				clk, step, _ := h.setup()
				tm := clk.NewTimer(h.d)

				go func() { <-tm.C() }()
				step(h.d)

				if tm.Reset(h.d) {
					t.Error("Reset after the timer fired = true, want false")
				}
			})

			t.Run("stop clears a stale fire", func(t *testing.T) {
				t.Parallel()
				clk, _, stepNoWait := h.setup()
				tm := clk.NewTimer(h.d)

				stepNoWait(h.d) // fires with nobody receiving
				tm.Stop()

				// Since Go 1.23 the stdlib guarantees this. It matters for game
				// code: a phase ending early stops its deadline, and a stale
				// value surviving would end the next phase the moment it starts.
				if didFire(tm) {
					t.Error("a value from before Stop survived it")
				}
			})

			t.Run("reset clears a stale fire", func(t *testing.T) {
				t.Parallel()
				clk, _, stepNoWait := h.setup()
				tm := clk.NewTimer(h.d)

				stepNoWait(h.d)
				tm.Reset(time.Hour)

				if didFire(tm) {
					t.Error("a value from before Reset survived it")
				}
			})

			// Note this is no longer the "fire into a full channel" case the
			// pre-1.23 stdlib had. Because Reset now clears any stale value,
			// values cannot accumulate through the public API at all; the drop
			// branch inside the fake's fire is a safety net rather than a path
			// a caller can reach. What is still worth pinning is that a second
			// fire never blocks and never stacks up.
			t.Run("second fire never blocks or stacks up", func(t *testing.T) {
				t.Parallel()
				clk, _, stepNoWait := h.setup()
				tm := clk.NewTimer(h.d)

				stepNoWait(h.d) // first fire, nobody receiving
				tm.Reset(h.d)

				// A fake that blocked here would hang the test rather than fail
				// it, so bound the wait.
				done := make(chan struct{})
				go func() { stepNoWait(h.d); close(done) }()
				select {
				case <-done:
				case <-time.After(2 * time.Second):
					t.Fatal("the second fire blocked instead of returning")
				}

				if n := queued(tm); n != 1 {
					t.Errorf("%d values queued, want 1", n)
				}
			})
		})
	}
}

// recvOrder returns a channel reporting the order in which the given timers
// fire, by name.
//
// One goroutine selecting over every channel, not one goroutine per timer:
// since Advance waits for each receipt before firing the next, a single receiver
// observes the true firing order. Two goroutines appending to a slice would be
// asserting on the Go scheduler instead, and would flake.
func recvOrder(names []string, tms []Timer) <-chan string {
	order := make(chan string, len(tms))
	go func() {
		for range tms {
			// A select over a fixed set cannot be written with a loop variable,
			// so poll the set instead; Advance is blocked until one of them is
			// taken, so this settles immediately.
			for {
				taken := false
				for i, tm := range tms {
					select {
					case <-tm.C():
						order <- names[i]
						taken = true
					default:
					}
					if taken {
						break
					}
				}
				if taken {
					break
				}
				runtime.Gosched()
			}
		}
		close(order)
	}()
	return order
}

// observeAtFire reports Now at the instant a timer fires, sampled before the
// value is taken.
//
// Polling len rather than receiving is the whole trick. Advance stays blocked in
// waitDrained until the value is drained, so sampling first and draining second
// is the only way to read the clock at the firing instant rather than at
// wherever the advance has walked to since. Receiving first and then reading Now
// races the advance loop, and loses often enough to flake.
//
// It leans on the fake's channel being buffered, which is fair game inside the
// fake's own package.
func observeAtFire(f *Fake, tm Timer, out chan<- time.Time) {
	for len(tm.C()) == 0 {
		runtime.Gosched()
	}
	out <- f.Now()
	<-tm.C()
}

// TestFakeAdvanceWalksToEachDeadline pins the property phase timestamps rest on:
// a handler reading Now when its timer fires sees its own deadline, not wherever
// the advance was headed.
//
// One advance spanning all three deadlines, because that is what separates
// walking from jumping. An implementation that set now to the target up front
// would report the same instant three times.
func TestFakeAdvanceWalksToEachDeadline(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)

	offsets := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second}
	nows := make(chan time.Time, len(offsets))
	for _, off := range offsets {
		go observeAtFire(f, f.NewTimer(off), nows)
	}

	f.Advance(20 * time.Second)

	// Arrival order is firing order: each observer publishes before it drains,
	// and Advance fires one timer at a time.
	for _, off := range offsets {
		if got, want := next(t, nows), epoch.Add(off); !got.Equal(want) {
			t.Errorf("Now at the %v fire = %v, want %v", off, got, want)
		}
	}
}

// TestFakeFiresInDeadlineOrderNotCreationOrder pins the full scan in
// earliestDue. Both timers are due within one advance, which is what separates
// a min-scan from taking the first due entry in slice order.
func TestFakeFiresInDeadlineOrderNotCreationOrder(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)

	// The later deadline is created first, so slice order and deadline order
	// disagree.
	slow := f.NewTimer(30 * time.Second)
	fast := f.NewTimer(8 * time.Second)

	order := recvOrder([]string{"slow", "fast"}, []Timer{slow, fast})
	f.Advance(30 * time.Second)

	if got := next(t, order); got != "fast" {
		t.Errorf("first fire = %q, want %q; earliestDue took slice order rather than the earliest deadline", got, "fast")
	}
	if got := next(t, order); got != "slow" {
		t.Errorf("second fire = %q, want %q", got, "slow")
	}
}

// TestFakeTiesBreakOnInsertionOrder pins the seq tie-break. Ties are the normal
// case, not an edge one: every player's turn timer starts on the same phase
// transition.
func TestFakeTiesBreakOnInsertionOrder(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)

	a := f.NewTimer(time.Second)
	b := f.NewTimer(time.Second)

	order := recvOrder([]string{"a", "b"}, []Timer{a, b})
	f.Advance(time.Second)

	if got := next(t, order); got != "a" {
		t.Errorf("first fire = %q, want %q; timers due at the same instant must fire in creation order", got, "a")
	}
	if got := next(t, order); got != "b" {
		t.Errorf("second fire = %q, want %q", got, "b")
	}
}

// TestFakeAdvanceWithNothingDueMovesNow covers the empty branch: with no timers
// pending, the whole duration still elapses.
func TestFakeAdvanceWithNothingDueMovesNow(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)

	f.Advance(time.Hour)

	if got, want := f.Now(), epoch.Add(time.Hour); !got.Equal(want) {
		t.Errorf("Now = %v, want %v", got, want)
	}
}

// TestFakeTimeNeverRunsBackwards pins the forward-only guard. A timer whose
// deadline is already behind the current instant still fires, but firing it must
// not rewind the clock for everything else.
func TestFakeTimeNeverRunsBackwards(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)
	f.Advance(10 * time.Second)

	stale := f.NewTimer(-5 * time.Second) // deadline five seconds in the past
	go func() { <-stale.C() }()

	f.Advance(0)

	if got, want := f.Now(), epoch.Add(10*time.Second); got.Before(want) {
		t.Errorf("Now = %v, want it never earlier than %v", got, want)
	}
}

// TestFakeNegativeAdvancePanics: winding a test's clock backwards is a bug in
// the test, and a loud failure beats a silent no-op.
func TestFakeNegativeAdvancePanics(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)

	defer func() {
		if recover() == nil {
			t.Error("Advance with a negative duration did not panic")
		}
	}()
	f.Advance(-time.Second)
}

// TestFakeAdvanceWaitsForReceipt is the fire-and-wait decision made observable.
// Without it nothing distinguishes Advance from AdvanceNoWait, and every phase
// test in S6 onwards would need its own synchronisation.
func TestFakeAdvanceWaitsForReceipt(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)
	tm := f.NewTimer(time.Second)

	const lag = 60 * time.Millisecond
	go func() {
		// Real time, and deliberately long enough that a fire-and-return
		// implementation would certainly have returned first.
		time.Sleep(lag)
		<-tm.C()
	}()

	start := time.Now()
	f.Advance(time.Second)
	elapsed := time.Since(start)

	// Elapsed time rather than a flag the receiver sets after draining: Advance
	// promises the value was received, not that the receiver went on to do
	// anything with it, so a flag set on the far side of the receive is exactly
	// the race this clock cannot win. How long Advance blocked is the property.
	if elapsed < lag/2 {
		t.Errorf("Advance returned after %v, want it to block until the receiver took the value roughly %v later", elapsed, lag)
	}
}

// TestFakeAdvanceNoWaitReturnsBeforeReceipt covers the escape hatch, and stops
// anyone collapsing the two entry points into one.
func TestFakeAdvanceNoWaitReturnsBeforeReceipt(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)
	tm := f.NewTimer(time.Second)

	// No receiver at all. Advance would wait out its budget and panic here;
	// AdvanceNoWait must return and leave the value waiting.
	f.AdvanceNoWait(time.Second)

	if !didFire(tm) {
		t.Error("AdvanceNoWait did not deliver the value")
	}
}

// TestFakeAbandonedTimerPanicsAfterBudget covers the diagnostic. A timer that
// fires with no receiver is a stuck test, and it has to say so rather than hang
// until the go test timeout.
//
// Not parallel: it writes the package-level drainBudget, and top-level parallel
// tests resume only once the sequential ones have finished.
func TestFakeAbandonedTimerPanicsAfterBudget(t *testing.T) {
	old := drainBudget
	drainBudget = 20 * time.Millisecond
	defer func() { drainBudget = old }()

	f := NewFake(epoch)
	f.NewTimer(time.Second) // nobody will ever receive from it

	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("an abandoned timer did not panic")
		}
		if msg, ok := r.(string); !ok || !strings.Contains(msg, "nothing received it") {
			t.Errorf("panic = %v, want it to explain that nothing received the fire", r)
		}
	}()
	f.Advance(time.Second)
}

// TestFakeAdvanceConcurrentWithReceiver drives Advance from one goroutine while
// the code under test runs in another, which is exactly how a phase test works.
//
// The assertion is mostly the race detector's: the rule that Fake.mu is released
// before every fire is invisible until something exercises it, and holding it
// across the send would deadlock against the receiver's own Now call.
func TestFakeAdvanceConcurrentWithReceiver(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)

	const n = 50
	timers := make([]Timer, n)
	for i := range timers {
		timers[i] = f.NewTimer(time.Duration(i+1) * time.Second)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		for _, tm := range timers {
			<-tm.C()
			_ = f.Now() // the call that would deadlock against a held lock
		}
	}()

	for range n {
		f.Advance(time.Second)
	}

	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("the receiver did not finish; Advance and the receiver deadlocked")
	}
}

// TestFakeStopPreventsLaterFire covers what keeps the common path off the drain
// budget: a phase that ends early stops its deadline, so no later advance fires
// a timer nobody is waiting for.
func TestFakeStopPreventsLaterFire(t *testing.T) {
	t.Parallel()
	f := NewFake(epoch)
	tm := f.NewTimer(time.Second)

	tm.Stop()

	// No receiver: if Stop left the timer pending this would fire and then wait
	// out the budget, so the test would panic rather than fail the assertion.
	f.Advance(10 * time.Second)

	if didFire(tm) {
		t.Error("a stopped timer fired on a later advance")
	}
}

// TestFakeResetReschedulesFromNow pins that the new deadline is measured from
// the current instant, not from the deadline being replaced.
func TestFakeResetReschedulesFromNow(t *testing.T) {
	t.Parallel()

	t.Run("measured from now, not from the old deadline", func(t *testing.T) {
		t.Parallel()
		f := NewFake(epoch)
		tm := f.NewTimer(10 * time.Second)

		f.Advance(5 * time.Second) // nothing due yet; now is epoch+5s
		tm.Reset(10 * time.Second) // so the new deadline is epoch+15s

		// Assert on the value delivered rather than on Now: the channel carries
		// the deadline itself, which makes this exact with nothing to race.
		got := make(chan time.Time, 1)
		go func() { got <- <-tm.C() }()
		f.Advance(10 * time.Second)

		if want := epoch.Add(15 * time.Second); !next(t, got).Equal(want) {
			t.Errorf("fired at the wrong deadline, want %v; Reset measured from the old deadline", want)
		}
	})

	t.Run("a fired timer can be reset and fire again", func(t *testing.T) {
		t.Parallel()
		f := NewFake(epoch)
		tm := f.NewTimer(time.Second)

		go func() { <-tm.C() }()
		f.Advance(time.Second)

		tm.Reset(time.Second)
		got := make(chan time.Time, 1)
		go func() { got <- <-tm.C() }()
		f.Advance(time.Second)

		if want := epoch.Add(2 * time.Second); !next(t, got).Equal(want) {
			t.Errorf("the reset timer fired at the wrong deadline, want %v", want)
		}
	})
}
