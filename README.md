# PiGradient (`pigradient`)

**Local Analytics Logger, Gateway, and Material Dashboard for AirGradient ONE Monitors**

PiGradient is a self-hosted, air-gapped local telemetry gateway and time-series archiver for the **AirGradient ONE** indoor air quality monitor. It runs natively on a Raspberry Pi as a single Go binary with no Node.js runtime or container dependencies, polling `/measures/current` at 1 Hz into monthly partitioned SQLite databases (WAL mode), pushing automated Day/Night brightness schedules via `PUT /config`, and serving the embedded web dashboard over your LAN.

---

## Architecture

- **Go Daemon (`server/`)**: Headless telemetry collector, monthly SQLite WAL archiver, EPA AQI & psychrometric analytics, AirGradient `/config` NVS proxy, Raspberry Pi Day/Night brightness scheduler, SSE stream (`1 Hz`), and embedded static asset server on `:8080`.
- **Web Frontend (`src/` -> `dashboard/dist/`)**: React + TypeScript + Chart.js interface compiled via Vite and baked into the Go binary using `//go:embed dist/*`.
- **Single-Process Deployment**: On your Raspberry Pi, `/usr/local/bin/pigradient` serves both the REST/SSE API and the web UI from one systemd unit (`pigradient.service`).

```text
pigradient/
├── server/
│   ├── cmd/pigradient/main.go   # YAML config + CLI flags, graceful shutdown
│   ├── config/                  # config.yaml loader + persistent runtime target overrides
│   ├── collector/               # 1s single-flight poller (/measures/current) + backoff
│   ├── store/                   # Monthly SQLite WAL partitions + seam-spanning queries
│   ├── analytics/               # EPA AQI, Dew Point, Heat Index, CO2 categorization
│   ├── broker/                  # Persistent 1 Hz SSE broadcaster
│   ├── logger/                  # In-memory ring buffer (/api/v1/logs) + journald mirror
│   └── api/                     # REST endpoints (/live, /history, /config, /schedule, /system, /logs)
├── src/                         # React + Tailwind v4 Material UI frontend
├── public/assets/               # Static assets (display_normal.svg B/W OLED vector)
├── dashboard/embed.go           # Embeds dashboard/dist/* into Go binary
├── packaging/
│   ├── config.yaml              # Installed to /etc/pigradient/config.yaml
│   ├── pigradient.service       # Systemd unit (/etc/systemd/system/pigradient.service)
│   └── debian/DEBIAN/           # .deb maintainer scripts (control, postinst, prerm)
├── .github/workflows/build-deb.yml
└── Makefile
```

---

## Deploying Locally to Your Raspberry Pi Network

### 1. Build the `.deb` or Standalone Binary

From a Linux/macOS host with Node.js 20+ and Go 1.22+:

```bash
# Build ARM64 Raspberry Pi binary (embeds Vite frontend automatically)
make build-pi

# Or build an installable ARM64 Debian package
make deb
scp bin/pigradient_1.0.0_arm64.deb pi@raspberrypi.local:~
```

*(For 32-bit Raspberry Pi OS, run `make build-armhf` or download the `armhf` / `arm64` `.deb` artifact from GitHub Actions.)*

### 2. Install & Configure on the Raspberry Pi

```bash
sudo dpkg -i pigradient_1.0.0_arm64.deb

# Point PiGradient at your AirGradient monitor's LAN IP or mDNS hostname
sudo nano /etc/pigradient/config.yaml
```

Example `/etc/pigradient/config.yaml`:

```yaml
target_device_url: "http://airgradient_<serial>.local" # or static LAN IP e.g. http://192.168.1.150
poll_interval_seconds: 1
listen_address: ":8080"
storage_directory: "/mnt/usb/pigradient"
```

> **Tip**: You can also update the target monitor URL live from the dashboard header (`<IP / Status>` button) — PiGradient persists UI target updates in `<storage_directory>/runtime.json` across reboots.

If you change `/etc/pigradient/config.yaml` directly:

```bash
sudo systemctl restart pigradient
sudo journalctl -u pigradient -f
```

### 3. Access on Your LAN

Open `http://<raspberry-pi-ip>:8080` (or `http://raspberrypi.local:8080`) from any browser on your local network.

---

## REST & Streaming API

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/v1/live` | `GET` | Current sensor frame, queried hardware metadata, EPA AQI, dew point, heat index |
| `/api/v1/stream` | `GET` | Persistent 1 Hz Server-Sent Events (SSE) stream |
| `/api/v1/history` | `GET` | Bucketed historical query across monthly SQLite files (`start`, `end`, `interval`) |
| `/api/v1/config` | `GET` / `PUT` | Direct proxy to AirGradient `/config` NVS keys + CO₂ 400 ppm / LED test triggers |
| `/api/v1/schedule` | `GET` / `PUT` | Pi-managed Day/Night brightness & 2–3 AM OLED burn-in off schedule (`schedule.json`) |
| `/api/v1/system` | `GET` / `PUT` | Gateway diagnostics, SQLite stats, uptime, memory, and live target monitor URL update |
| `/api/v1/logs` | `GET` | Live ring-buffer daemon logs |
| `/api/v1/widget` | `GET` | Compact JSON summary for home widgets / HUDs |

---

## Local Development Preview

```bash
npm install
go run ./server/cmd/pigradient   # terminal 1 — Go API on :8080
npm run dev                      # terminal 2 — Vite dev server on :3000
```

`npm run dev` serves the Vite development server on port `3000` and proxies `/api/*` (REST + SSE) to the Go daemon on `:8080`. The Go daemon is the only API implementation; simulation and pre-seeded telemetry do not exist anywhere in the stack — the daemon ingests only from a configured monitor.
