//go:build linux

package store

import "syscall"

// freeDiskSpaceBytes reports available bytes for unprivileged users on the
// filesystem containing path (Statfs f_bavail * f_bsize); -1 on failure.
func freeDiskSpaceBytes(path string) int64 {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return -1
	}
	return int64(st.Bavail) * int64(st.Bsize)
}
