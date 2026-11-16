//go:build !linux

package store

// freeDiskSpaceBytes is only implemented for Linux targets (the deployment
// platform); other platforms report unknown (-1).
func freeDiskSpaceBytes(path string) int64 {
	return -1
}
