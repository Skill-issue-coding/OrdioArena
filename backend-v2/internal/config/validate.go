package config

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
)

// loader collects problems instead of returning the first one.
type loader struct {
	get      lookup
	dev      bool
	defaults []string
	problems []string
}

// ValidationError carries every problem found in one pass over the environment.
// A bad configuration fails once with the whole list, rather than one variable
// per redeploy, which on a three-instance stack is the worst loop available.
type ValidationError struct{ Problems []string }

// Error renders the problems as one operator-facing message: a single line when
// there is one problem, an indented bullet list when there are several.
func (e *ValidationError) Error() string {
	if len(e.Problems) == 0 {
		return "invalid configuration"
	}

	if len(e.Problems) == 1 {
		return fmt.Sprintf("invalid configuration: %s", e.Problems[0])
	}

	// The separator has to lead as well as separate: Join only puts it between
	// elements, which would leave the first problem unindented and unbulleted.
	return fmt.Sprintf("invalid configuration (%d problems):\n  - %s",
		len(e.Problems), strings.Join(e.Problems, "\n  - "))
}

// value resolves one variable, trimmed. A whitespace-only value counts as
// absent, so "SESSION_KEYS=" fails exactly like a missing SESSION_KEYS instead
// of passing through as a zero-length secret.
func (l *loader) value(name string) (string, bool) {
	v, ok := l.get(name)
	v = strings.TrimSpace(v)
	return v, ok && v != ""
}

// required resolves a variable that has no default in any environment. A
// missing one records a problem and returns "", so the caller must guard on the
// empty string before parsing it further.
func (l *loader) required(name string) string {
	value, ok := l.value(name)
	if ok {
		return value
	} else {
		l.problem("%s is required", name)
		return ""
	}
}

// optional resolves a variable that falls back to def when absent. The variable
// name, never its value, is recorded in Source.Defaults, so a default taken is
// visible in the boot log rather than silent.
func (l *loader) optional(name, def string) string {
	value, ok := l.value(name)
	if ok {
		return value
	} else {
		l.defaults = append(l.defaults, name)
		return def
	}
}

// devOptional is required in production and defaulted in development. Keeping
// that rule in one place is what stops individual variables drifting into
// silent production defaults one call site at a time.
func (l *loader) devOptional(name, devDefault string) string {
	var v string
	if l.dev {
		v = l.optional(name, devDefault)
	} else {
		v = l.required(name)
	}
	return v
}

// problem records one operator-facing problem. Collected rather than returned,
// so a single pass reports every fault it finds.
func (l *loader) problem(format string, a ...any) {
	l.problems = append(l.problems, fmt.Sprintf(format, a...))
}

// absorb folds an error from a parse helper into the collected problems,
// prefixing each with the variable it came from. A *ValidationError is
// flattened, so four bad peers report as four lines rather than one.
func (l *loader) absorb(name string, err error) {
	if ve, ok := errors.AsType[*ValidationError](err); ok {
		for _, p := range ve.Problems {
			l.problem("%s: %s", name, p)
		}
	} else {
		l.problem("%s: %v", name, err)
	}
}

// source returns the provenance half that loadFrom can know on its own. Load
// fills in File, FileKeys and EnvKeys, which need the real environment rather
// than the abstract lookup loadFrom is given.
func (l *loader) source() Source { return Source{Defaults: l.defaults} }

// validateListenAddr checks the bind address is host:port with a numeric port
// in range. An empty host is valid, ":8080" binds every interface. Named ports
// (":http") are deliberately rejected: compose and the proxy want a number.
func validateListenAddr(raw string) error {
	_, port, err := net.SplitHostPort(raw)
	if err != nil {
		return fmt.Errorf("want host:port or :port, got %v", err)
	}

	if port == "" {
		return fmt.Errorf("missing port")
	}

	portNum, err := strconv.Atoi(port)
	if err != nil {
		return fmt.Errorf("strconv error when converting port, %v", err)
	}

	if portNum < 1 || portNum > 65535 {
		return fmt.Errorf("invalid port")
	}

	return nil
}
