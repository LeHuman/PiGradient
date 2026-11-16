package config

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type AppConfig struct {
	TargetDeviceURL     string `yaml:"target_device_url"`
	PollIntervalSeconds int    `yaml:"poll_interval_seconds"`
	ListenAddress       string `yaml:"listen_address"`
	StorageDirectory    string `yaml:"storage_directory"`
}

func Default() AppConfig {
	return AppConfig{
		TargetDeviceURL:     "http://192.168.1.150",
		PollIntervalSeconds: 1,
		ListenAddress:       ":8080",
		StorageDirectory:    "/mnt/usb/pigradient",
	}
}

// AtomicWriteFile writes data to a temporary file, syncs to disk, and atomically renames it
// so sudden power loss on Raspberry Pi SD/USB storage cannot corrupt configuration JSON.
func AtomicWriteFile(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, filepath.Base(path)+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	cleanup = false
	return nil
}

// LoadYAML reads simple top-level key: value settings from config.yaml without external dependencies.
func LoadYAML(path string, cfg *AppConfig) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	inTopLevel := true
	for scanner.Scan() {
		rawLine := scanner.Text()
		trimmed := strings.TrimSpace(rawLine)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Track indentation so nested sections (sqlite:, calibration:, integrations:) do not collide
		isIndented := len(rawLine) > 0 && (rawLine[0] == ' ' || rawLine[0] == '\t')
		if isIndented {
			if !inTopLevel {
				continue
			}
		}

		if idx := strings.Index(trimmed, " #"); idx != -1 {
			trimmed = strings.TrimSpace(trimmed[:idx])
		}

		colon := strings.IndexByte(trimmed, ':')
		if colon == -1 {
			continue
		}
		key := strings.TrimSpace(trimmed[:colon])
		val := strings.TrimSpace(trimmed[colon+1:])
		if val == "" {
			inTopLevel = false
			continue
		}
		inTopLevel = true

		val = strings.Trim(val, `"'`)

		switch key {
		case "target_device_url":
			if val != "" {
				cfg.TargetDeviceURL = NormalizeDeviceURL(val)
			}
		case "poll_interval_seconds":
			if n, err := strconv.Atoi(val); err == nil && n >= 1 {
				cfg.PollIntervalSeconds = n
			}
		case "listen_address":
			if val != "" {
				cfg.ListenAddress = val
			}
		case "storage_directory":
			if val != "" {
				cfg.StorageDirectory = val
			}
		}
	}
	return scanner.Err()
}

// ValidateDeviceURL ensures a target AirGradient monitor URL uses http/https with a valid host.
func ValidateDeviceURL(raw string) (string, error) {
	u := strings.TrimSpace(raw)
	if u == "" {
		return "", fmt.Errorf("device URL cannot be empty")
	}
	lower := strings.ToLower(u)
	if !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		if strings.Contains(u, "://") {
			return "", fmt.Errorf("unsupported URL scheme (must be http or https)")
		}
		u = "http://" + u
	}
	parsed, err := url.Parse(u)
	if err != nil {
		return "", fmt.Errorf("malformed URL: %w", err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return "", fmt.Errorf("URL must include a valid host or IP address")
	}
	return strings.TrimRight(parsed.String(), "/"), nil
}

func NormalizeDeviceURL(raw string) string {
	normalized, err := ValidateDeviceURL(raw)
	if err != nil {
		return "http://192.168.1.150"
	}
	return normalized
}

type runtimeState struct {
	TargetDeviceURL string `json:"targetDeviceUrl,omitempty"`
	PollIntervalSec int    `json:"pollIntervalSec,omitempty"`
}

// TargetStore keeps the active AirGradient device URL and poll cadence synchronized
// across the collector, /config proxy, Day/Night scheduler, and /api/v1/system handler.
type TargetStore struct {
	mu           sync.RWMutex
	deviceURL    string
	pollInterval time.Duration
	stateFile    string
}

func NewTargetStore(deviceURL string, pollInterval time.Duration, storageDir string) *TargetStore {
	if pollInterval < time.Second {
		pollInterval = time.Second
	}
	ts := &TargetStore{
		deviceURL:    NormalizeDeviceURL(deviceURL),
		pollInterval: pollInterval,
		stateFile:    filepath.Join(storageDir, "runtime.json"),
	}
	ts.loadRuntime()
	return ts
}

func (t *TargetStore) loadRuntime() {
	data, err := os.ReadFile(t.stateFile)
	if err != nil {
		return
	}
	var st runtimeState
	if err := json.Unmarshal(data, &st); err != nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if st.TargetDeviceURL != "" {
		if validated, err := ValidateDeviceURL(st.TargetDeviceURL); err == nil {
			t.deviceURL = validated
		}
	}
	if st.PollIntervalSec >= 1 && st.PollIntervalSec <= 3600 {
		t.pollInterval = time.Duration(st.PollIntervalSec) * time.Second
	}
}

func (t *TargetStore) saveRuntimeLocked() {
	if t.stateFile == "" {
		return
	}
	st := runtimeState{
		TargetDeviceURL: t.deviceURL,
		PollIntervalSec: int(t.pollInterval.Seconds()),
	}
	if data, err := json.MarshalIndent(st, "", "  "); err == nil {
		_ = AtomicWriteFile(t.stateFile, data, 0644)
	}
}

func (t *TargetStore) DeviceURL() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.deviceURL
}

func (t *TargetStore) SetDeviceURL(raw string) string {
	normalized := NormalizeDeviceURL(raw)
	t.mu.Lock()
	t.deviceURL = normalized
	t.saveRuntimeLocked()
	t.mu.Unlock()
	return normalized
}

func (t *TargetStore) PollInterval() time.Duration {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.pollInterval
}

func (t *TargetStore) SetPollIntervalSec(sec int) time.Duration {
	if sec < 1 {
		sec = 1
	}
	d := time.Duration(sec) * time.Second
	t.mu.Lock()
	t.pollInterval = d
	t.saveRuntimeLocked()
	t.mu.Unlock()
	return d
}
