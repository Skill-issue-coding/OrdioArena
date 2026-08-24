package config

type Source struct {
	File     string   // ".env"; empty when absent
	FileKeys []string // keys the file supplied, keys only, never values
	EnvKeys  []string
	Defaults []string // keys that fell back to a default
}
