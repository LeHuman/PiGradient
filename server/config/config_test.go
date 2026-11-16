package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadYAMLAndTargetStore(t *testing.T) {
	dir := t.TempDir()
	yamlPath := filepath.Join(dir, "config.yaml")
	content := `# Comment
target_device_url: "192.168.1.222/"
poll_interval_seconds: 2
listen_address: ":9090"
storage_directory: "/var/lib/pigradient"
sqlite:
  journal_mode: "WAL"
`
	if err := os.WriteFile(yamlPath, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}

	cfg := Default()
	if err := LoadYAML(yamlPath, &cfg); err != nil {
		t.Fatalf("LoadYAML failed: %v", err)
	}
	if cfg.TargetDeviceURL != "http://192.168.1.222" {
		t.Fatalf("unexpected target URL: %s", cfg.TargetDeviceURL)
	}
	if cfg.PollIntervalSeconds != 2 {
		t.Fatalf("unexpected poll interval: %d", cfg.PollIntervalSeconds)
	}
	if cfg.ListenAddress != ":9090" {
		t.Fatalf("unexpected listen address: %s", cfg.ListenAddress)
	}
	if cfg.StorageDirectory != "/var/lib/pigradient" {
		t.Fatalf("unexpected storage directory: %s", cfg.StorageDirectory)
	}

	ts := NewTargetStore(cfg.TargetDeviceURL, 0, dir)
	if ts.DeviceURL() != "http://192.168.1.222" {
		t.Fatalf("unexpected initial store URL: %s", ts.DeviceURL())
	}
	ts.SetDeviceURL("airgradient_1234.local/")

	reloaded := NewTargetStore("http://192.168.1.1", 0, dir)
	if reloaded.DeviceURL() != "http://airgradient_1234.local" {
		t.Fatalf("expected persisted URL http://airgradient_1234.local, got %s", reloaded.DeviceURL())
	}
}
