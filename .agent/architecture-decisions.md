# PiGradient Architecture & Engineering Decisions

This document records key architectural, reliability, UI/analytics, and operational decisions made in PiGradient.

---

## 1. Single-Runtime Architecture (Go Production Daemon + Vite Dev Proxy)
- **Production (`server/` + `dashboard/embed.go`)**: Single static Go binary (`CGO_ENABLED=0` using `modernc.org/sqlite`) embedding the Vite-built React frontend (`//go:embed dist/*`). Designed to run air-gapped on Raspberry Pi under `systemd` with zero Node.js or external database dependencies.
- **Development Preview (`vite.config.ts`)**: `npm run dev` serves the Vite dev server with a `/api` proxy to the Go daemon (`go run ./server/cmd/pigradient`, port `8080`). The Go daemon is the only API implementation; the frontend talks to it identically in dev and production.

## 2. Zero Simulation / Zero Spoofing by Default
- The Go daemon never simulates, spoofs, or synthesizes telemetry; it ingests only from a configured AirGradient monitor.
- When unconfigured (`targetDeviceUrl === ""`) or disconnected:
  - Collector avoids spurious probe traffic when no monitor URL is set (`pollDevice()` stays idle until configured via `AIRGRADIENT_URL` or **Device Controls → Connectivity**).
  - `/api/v1/live`, `/api/v1/history`, `/api/v1/system`, `/api/v1/config`, `/api/v1/schedule`, and `/api/v1/widget` return `200 OK` cleanly (`timestamp: 0`, `last_seen_seconds_ago: -1`, `history: []`) so UI/preview harnesses experience zero HTTP 5xx errors or runtime exceptions.
  - UI KPI cards display `--` placeholders instead of misleading `0` / `"Good"` statuses, and show a non-blocking **Configure Connectivity** guide card.
  - Collector `WARN`/`ERROR` offline transitions are recorded in `/api/v1/logs` for the Diagnostics UI without flooding stdout.

## 3. Data Collection Robustness & Storage Integrity (`server/`)
- **Single-Flight Poller (`server/collector/poller.go`)**: Uses `atomic.Bool` compare-and-swap to prevent overlapping HTTP polls if a device hangs, a `1.8s` request timeout, `1 MiB` response cap, `NaN`/`Inf`/all-zero sensor warm-up rejection, and exponential backoff (`1s` -> `5s` after 3 errors -> `15s` after 10 errors) with `TriggerImmediatePoll()` wake-up on target changes.
- **Monthly Partitioned SQLite WAL (`server/store/`)**: Stores telemetry in monthly `pigradient_YYYY_MM.db` files (`WAL` mode with autocheckpoint disabled, `synchronous=NORMAL`, `busy_timeout`, explicit `wal_checkpoint(TRUNCATE)` every 15 minutes and on shutdown — cloud-sync-friendly, `.db` files stay stable between checkpoints) with atomic batched writes (`500`-record channel), upsert on timestamp conflict (replaces `INSERT OR IGNORE`, so retried records update instead of being dropped), the redundant timestamp index dropped, a 6-hour in-RAM retry buffer re-flushed on reconnect, and a history bucket cap. Storage health (`storageStatus`, `lastWriteError`, `droppedRecords`, `diskFreeBytes`) is exposed on `/api/v1/system`, and `GET /api/v1/export.csv` streams the raw CSV export. Historical range queries still span monthly file seams.
- **Atomic Config & Schedule Persistence (`server/config/config.go`, `server/api/handlers_schedule.go`)**: `AtomicWriteFile` writes temporary files, calls `Sync()`, and atomically `Rename()`s `runtime.json` and `schedule.json` to prevent SD/USB corruption during power loss.
- **API & Validation**: Every action exposed by the web UI (`PUT /api/v1/config` NVS keys, `co2CalibrationRequested`, `ledBarTestRequested`, `PUT /api/v1/schedule`, `PUT /api/v1/system` target URL & cadence) is strictly type/range-validated in `server/api/*` — the single API implementation.

## 4. Dashboard UX & Environmental Analytics (`src/`)
- **Monitor & Trends (`ConsoleView.tsx`)**:
  - Single unified live view across all presets (`5m` at 1 Hz; `15m`..`30d` throttled live bucket updates when perceptible changes occur), with Pause/Resume adjacent to range presets.
  - Signals: `CO₂`, `PM1.0`, `PM2.5`, `PM10`, `Temp`, `Humidity`, `TVOC`, `NOx`, plus derived `EPA AQI`, `Dew Pt`, `Heat Idx`, and `Abs Hum`.
  - **Analytics Drawer**: Trailing moving averages scaled to resolution, Rolling Avg Only mode, Guidelines/Limits threshold overlays, Window Stats table (`Min`, `Avg`, `Max`, `σ`, `Δ Net`), and CSV export.
  - **Signals & Limits Guide (`SignalReferenceDialog.tsx`)**: Tabbed reference modal explaining every signal, guideline vs. limit thresholds, status label justification, good vs. bad examples, and authoritative citations (US EPA 2024/2021, ASHRAE 55/62.1, Sensirion SGP41, NWS).
- **Navigation & Accessibility**: Clicking the top-right connection indicator navigates directly to **Device Controls → Connectivity**. Includes High Contrast, Large Text, Reduce Motion, and Colorblind-Safe chart modes (`AccessibilityContext.tsx`).

## 5. Privacy & Packaging Hygiene
- No personal names, email addresses, API secrets, or real hardware serials/MAC addresses are committed in code, configs, or documentation (`README.md` uses `<serial>` placeholders and RFC1918 LAN examples).
- Debian `.deb` packaging uses a single canonical `packaging/config.yaml` and `packaging/pigradient.service`, preserves user config via `DEBIAN/conffiles`, enforces `--root-owner-group` ownership, and supports `arm64`, `armhf`, and `amd64`.
