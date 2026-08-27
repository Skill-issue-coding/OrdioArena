package clock

import "time"

// Clock is the only source of time in the backend. Every deadline and timestamp
// goes through one, so a test can drive an hour of game time instantly instead
// of sleeping through it.
type Clock interface {
	Now() time.Time
	NewTimer(d time.Duration) Timer
	After(d time.Duration) <-chan time.Time
}

// Timer is one scheduled deadline, mirroring time.Timer. It is an interface
// rather than *time.Timer because the fake supplies its own, which is why C is a
// method here and a field there.
type Timer interface {
	C() <-chan time.Time
	Stop() bool
	Reset(d time.Duration) bool
}

// Real returns the production clock, a thin wrapper over the time package.
func Real() Clock { return realClock{} }

// realClock is the production implementation, holding no state of its own.
type realClock struct{}

// Now reports the current wall-clock time.
func (realClock) Now() time.Time { return time.Now() }

// NewTimer schedules a deadline d from now, backed by a real time.Timer.
func (realClock) NewTimer(d time.Duration) Timer { return realTimer{t: time.NewTimer(d)} }

// After is sugar over NewTimer so there is one scheduling path rather than two,
// matching Fake. Like time.After, the timer is not collected until it fires.
func (c realClock) After(d time.Duration) <-chan time.Time { return c.NewTimer(d).C() }

// realTimer adapts *time.Timer to the Timer interface. Every method forwards
// unchanged, so the semantics the fake has to match are exactly the stdlib's.
type realTimer struct{ t *time.Timer }

// C returns the channel the deadline is delivered on.
func (r realTimer) C() <-chan time.Time { return r.t.C }

// Stop reports whether it stopped a timer that had not yet fired.
func (r realTimer) Stop() bool { return r.t.Stop() }

// Reset reschedules the timer to fire d from now, reporting whether it was still
// pending.
func (r realTimer) Reset(d time.Duration) bool { return r.t.Reset(d) }
