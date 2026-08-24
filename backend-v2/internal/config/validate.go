package config

// loader collects problems instead of returning the first one.
type loader struct {
	get      lookup
	dev      bool
	defaults []string
	problems []string
}

type ValidationError struct{ Problems []string }

func (e *ValidationError) Error() string

// one problem  → "invalid configuration: <p>"
// many         → "invalid configuration (N problems):\n  - p1\n  - p2"

func (l *loader) value(name string) (string, bool)           // trims; empty counts as absent
func (l *loader) required(name string) string                // absent → problem, returns ""
func (l *loader) optional(name, def string) string           // absent → def, appends to l.defaults
func (l *loader) devOptional(name, devDefault string) string // dev: like optional; prod: like required
func (l *loader) problem(format string, a ...any)
func (l *loader) absorb(name string, err error) // flattens *ValidationError, prefixes each with name
func (l *loader) source() Source                // Source{Defaults: l.defaults}
func validateListenAddr(raw string) error
