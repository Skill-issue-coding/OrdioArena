package httpx

import "runtime/debug"

// Revision reports the VCS commit this binary was built from, so /api/status can
// answer what is actually running on an instance. It returns "unknown" whenever the
// toolchain stamped nothing, go run, go test, or a container built without .git in
// the build context.
func Revision() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	for _, s := range bi.Settings {
		if s.Key == "vcs.revision" {
			return s.Value
		}
	}
	return "unknown"
}
