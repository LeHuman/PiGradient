# PiGradient

<!-- KEYWORDS: Air Quality, AirGradient, Raspberry Pi, Self-hosted -->
<!-- LANGUAGES: Go, TypeScript -->
<!-- TECHNOLOGY: React, Vite, SQLite, Tailwind CSS, systemd -->
<!-- COLOR: #111318, #2563eb -->

<!-- STATUS -->
**Prototype**

<!-- DESCRIPTION START -->
Self-hosted telemetry gateway and time-series archiver for AirGradient ONE indoor air quality monitors. A single Go binary on a Raspberry Pi polls the monitor at 1 Hz into monthly-partitioned SQLite databases and serves an embedded web dashboard over the LAN.
<!-- DESCRIPTION END -->

<!-- WHY START -->
AirGradient devices only retain short onboard history. PiGradient keeps a full-resolution local archive on your own hardware — no cloud account, no telemetry, no external dependencies — and makes it retrievable via API, CSV export, or plain SQLite files.
<!-- WHY END -->

## Features

- 1 Hz polling of `/measures/current` with single-flight dedup, backoff, and unsynced-clock rejection
- Monthly `pigradient_YYYY_MM.db` SQLite partitions (WAL, explicit 15-minute checkpoints, cloud-sync friendly)
- Storage health in the dashboard: write errors, dropped/queued records, disk free
- Bucketed history API with range cap + streaming raw CSV export (`/api/v1/export.csv`)
- 1 Hz SSE live view (React + Chart.js), EPA AQI, dew point, heat index, absolute humidity
- Day/Night OLED brightness schedule with 2–3 AM burn-in off (pushed via `PUT /config`)
- `.deb` packaging (arm64/armhf/amd64) with systemd unit, built by GitHub Actions
- Serves at root or any configured `base_path` (reverse-proxy friendly)

## Requirements

- Raspberry Pi (64-bit or 32-bit OS) on the same LAN as an AirGradient ONE, firmware v3.0.10+ (v3.1.4+ recommended)
- ext4 USB drive mounted at `/mnt/usb` for the archive
- Build host: Node.js 22+, Go 1.26+

## Installation

Build locally (`make deb`, needs Linux/macOS/WSL for `dpkg-deb`) or download the `.deb` from GitHub Actions:

```bash
scp bin/pigradient_1.0.0_arm64.deb pi@raspberrypi.local:~
ssh pi@raspberrypi.local
sudo dpkg -i pigradient_1.0.0_arm64.deb
sudo mkdir -p /mnt/usb/pigradient
sudo chown -R pigradient:pigradient /mnt/usb/pigradient
sudo systemctl enable --now pigradient
```

The installer creates the `pigradient` system user, `/etc/pigradient/config.yaml`, and the systemd unit. The archive directory is **not** created at install time — mount the drive first (see Storage below).

## Configuration

`/etc/pigradient/config.yaml`:

```yaml
target_device_url: "http://airgradient_<serial>.local" # or LAN IP
poll_interval_seconds: 1
listen_address: ":8080"
storage_directory: "/mnt/usb/pigradient"
base_path: "" # set "/pigradient" to serve under a subpath
```

Restart with `sudo systemctl restart pigradient`; logs via `journalctl -u pigradient -f`. The target URL can also be changed live from the dashboard header (persisted in `<storage_directory>/runtime.json`).

## Storage

- Mount an ext4 USB drive at `/mnt/usb` via `/etc/fstab` (`defaults,noatime,nofail`); FAT lacks ownership bits and the service declares `RequiresMountsFor=/mnt/usb`.
- The unit starts after `time-sync.target`; samples with unsynced-clock timestamps are rejected, never archived under a wrong month.
- **Cloud sync**: run the sync agent one-way (send-only) against `/mnt/usb/pigradient`, excluding `*.db-wal`, `*.db-shm`, `*.db-journal`, `*.tmp*`. The daemon checkpoints WAL every 15 minutes so `.db` files stay stable between checkpoints; sidecars must never be synced, and one-way sync prevents the agent overwriting an open database.

## Reverse proxy

For a Pi hosting multiple services, Caddy is the standard front door (auto-HTTPS, flushes SSE with no extra config):

```
pidev {
    redir /pigradient /pigradient/ 308
    handle /pigradient/* {
        reverse_proxy 127.0.0.1:8080
    }
}
```

nginx alternative requires `proxy_buffering off;` and `proxy_read_timeout 3600;` for SSE.

## API

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/live` | `GET` | Current frame, device metadata, EPA AQI, dew point, heat index |
| `/api/v1/stream` | `GET` | 1 Hz SSE stream |
| `/api/v1/history` | `GET` | Bucketed query (`start`, `end`, `interval`), capped at 2500 buckets |
| `/api/v1/export.csv` | `GET` | Streaming raw CSV, all 14 columns (`start`, `end`, optional `interval`) |
| `/api/v1/config` | `GET`/`PUT` | Proxy to AirGradient `/config` NVS keys, CO₂ calibration, LED test |
| `/api/v1/schedule` | `GET`/`PUT` | Day/Night brightness schedule |
| `/api/v1/system` | `GET`/`PUT` | Diagnostics, storage health, target URL update |
| `/api/v1/logs` | `GET` | Ring-buffer daemon logs |
| `/api/v1/widget` | `GET` | Compact JSON for widgets/HUDs |

All routes are also registered under `base_path` when set.

## Development

```bash
npm install
go run ./server/cmd/pigradient   # terminal 1 — Go API on :8080
npm run dev                      # terminal 2 — Vite dev server on :3000
```

`npm run dev` proxies `/api/*` to the daemon on `:8080`. The Go daemon is the only API implementation; it never simulates telemetry. Checks: `npm run lint`, `npm run build`, `make test`.

## Security

No authentication by design — the daemon serves plain HTTP on the LAN. Do not expose it beyond your network; put it behind an authenticating proxy if remote access is needed.

## License

MIT — see [LICENSE](LICENSE).

