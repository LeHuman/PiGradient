# Self-Contained Build Plan: PiGradient Windows System Tray App with Widget Flyout

> **How to use this file**: Copy and paste the contents of this document directly into a brand-new coding session. It contains all context, backend API contracts, environmental thresholds, visual design tokens, and architecture decisions needed to build the companion Windows desktop tray app independently.

---

## 1. Project Context & Purpose
**PiGradient** is a self-hosted, local-LAN telemetry gateway running on a Raspberry Pi (default port `:8080`) that polls an **AirGradient ONE (I-9PSL)** indoor air quality monitor every `1 second`, archives telemetry into monthly SQLite WAL databases, and serves a REST + `1 Hz` Server-Sent Events (SSE) API.

Your task is to build the **PiGradient Companion Windows Tray App** (`Windows 10 / 11`):
1. **System Tray Presence**: A quiet notification-area icon with a live AQI/CO₂ status color badge and rich hover tooltip (`PiGradient · AQI 21 (Good) · CO₂ 612 ppm · 71.8°F / 45% RH`).
2. **Taskbar-Anchored Widget Flyout (`~360 × 440 px`)**: Left-clicking the tray icon opens a sleek, borderless, dark Material-styled popup card anchored directly above the Windows taskbar — giving instant access to all 4 KPI tiles, a compact sparkline, and quick device actions without opening a full browser window.

### Strict Behavioral Rules (Must Preserve)
- **Local-First & Zero Cloud**: Communicates strictly over the user's LAN with their Raspberry Pi gateway (`http://raspberrypi.local:8080` or `http://192.168.1.x:8080`). No telemetry/analytics tracking or cloud services.
- **Zero Simulation or Spoofed Telemetry**: Never invent or display fake numbers (`0 ppm`, `"Good"`, fake device metadata). When unconfigured, unreachable, or `timestamp <= 0`, show `--` placeholders, neutral slate `#475569` accents, and a calm inline prompt to set the gateway URL.

---

## 2. PiGradient Backend API Contract (Already Implemented on Gateway)

Base URL is user-configured (default port `8080` on Raspberry Pi, or `http://localhost:8080` when testing against the Go daemon via `go run ./server/cmd/pigradient`). All JSON endpoints set CORS `*` and return `application/json`.

### A. `GET /api/v1/widget` (Low-Overhead Idle Polling Endpoint)
```json
{
  "aqi": 21,
  "aqi_desc": "Good",
  "aqi_color": "#10B981",
  "co2": 612,
  "temp": "72°F",
  "temp_c": "22°C",
  "humidity": "45%",
  "updated": "02:14 PM"
}
```
When `timestamp <= 0`, returns `{ "aqi": 0, "aqi_desc": "No Data", "aqi_color": "#64748B", "co2": 0, "temp": "--", "temp_c": "--", "humidity": "--", "updated": "--" }`.

### B. `GET /api/v1/live` & `GET /api/v1/stream` (`text/event-stream`, 1 Hz SSE)
SSE emits `data: <JSON>\n\n` every ~1 second (with `: keepalive\n\n` every ~25s) using the `/api/v1/live` payload:
```json
{
  "status": "online",
  "is_simulated": false,
  "error_message": null,
  "last_seen_seconds_ago": 0,
  "timestamp": 1763251200,
  "latency_ms": 12,
  "device": {
    "serialno": "a1b2c3d4e5f6",
    "firmware": "3.1.4",
    "model": "I-9PSL",
    "wifi_rssi": -54,
    "boot_count": 14
  },
  "raw": {
    "pm01": 3.2,
    "pm02": 5.6,
    "pm10": 7.1,
    "pm02_comp": 5.1,
    "rco2": 612,
    "atmp": 23.4,
    "atmp_comp": 22.1,
    "rhum": 48.0,
    "rhum_comp": 45.0,
    "tvoc_index": 98,
    "tvoc_raw": 28450,
    "nox_index": 1,
    "nox_raw": 18120,
    "boot_count": 14
  },
  "processed": {
    "aqi_pm25": 21,
    "aqi_category": "Good",
    "aqi_color": "#10B981",
    "nowcast_aqi": 20,
    "co2_level": "Good (<800 ppm · Well-ventilated)",
    "co2_category": "optimal",
    "temp_f": 71.8,
    "temp_c": 22.1,
    "humidity": 45.0,
    "dew_point_c": 9.6,
    "dew_point_f": 49.3,
    "heat_index_c": 22.1,
    "heat_index_f": 71.8
  }
}
```
- **Crucial Guard**: Treat `timestamp <= 0` as **No Telemetry Yet** (render `--`, never `0 AQI` / `"Good"`).
- `status` is `"online" | "degraded" | "offline"`. `last_seen_seconds_ago` is `-1` if never polled successfully.

### C. `GET /api/v1/history?start=<unix>&end=<unix>&interval=<sec>`
Returns chronological array (or `[]` when empty):
`[{ timestamp, pm01, pm02_comp, pm10, rco2, atmp_comp, rhum_comp, tvoc_index, nox_index }]`.
Great for a compact `1h` (`interval=30` or `60`) sparkline inside the flyout!

### D. `GET /api/v1/system`, `/api/v1/config`, `/api/v1/schedule`
- `GET /api/v1/system`: `{ targetDeviceUrl, pollIntervalSec, collectorStatus, latencyMs, totalRecordsRecorded, uptimeSeconds, device }`.
- `PUT /api/v1/config`: Quick hardware actions from the tray flyout (e.g., `{ "configurationControl": "local", "ledBarTestRequested": true }` or toggling `ledBarMode` `"pm" | "co2" | "off"`).
- `GET / PUT /api/v1/schedule`: Toggle automated Day/Night brightness schedule (`enabled: true/false`).

---

## 3. Environmental Thresholds & Colors (Exact Match)

| Metric | Rating / Thresholds | Color / Accent |
| :--- | :--- | :--- |
| **PM2.5 EPA AQI** | `0–50` Good (`0.0–12.0 µg/m³`), `51–100` Moderate (`12.1–35.4`), `101–150` Unhealthy for Sensitive Groups (`35.5–55.4`), `151–200` Unhealthy (`55.5–150.4`), `201–300` Very Unhealthy (`150.5–250.4`), `301–500` Hazardous (`250.5+`) | `#10B981`, `#F59E0B`, `#F97316`, `#EF4444`, `#8B5CF6`, `#7F1D1D` |
| **CO₂ (NDIR)** | `<800` Good (`optimal`), `800–999` Moderate (`fair`), `1000–1399` Elevated (`poor`), `≥1400` High (`critical`). Gauge: `400–1800 ppm`. | Emerald `#10B981`, Amber `#F59E0B`, Orange `#F97316`, Rose `#F43F5E` |
| **TVOC / NOx (SGP41)** | Normal: `TVOC < 150 && NOx < 5`; Moderate: `TVOC ≥ 150 || NOx ≥ 5`; Elevated: `TVOC ≥ 250 || NOx ≥ 20`; High: `TVOC ≥ 400 || NOx ≥ 100` (`1–500` index; baselines `TVOC=100`, `NOx=1`). | Emerald, Sky `#38BDF8`, Amber, Rose |

---

## 4. Visual Design Tokens (Matches Web Dashboard)
- **Backgrounds**: Outer `#111318`, Card Tile `#181B22`, Subtle Border `rgba(255, 255, 255, 0.08)`, Header Strip `#14171D`
- **Primary Accent**: `#2563EB` / `#60A5FA`
- **Text**: Primary `#E6E8EE` / `#FFFFFF`, Secondary `#9CA3AF`, Muted `#7E8596`
- **Fonts**: `'Plus Jakarta Sans'` (headers), `'DM Sans'` / `'Segoe UI Variable'` (body labels), `'JetBrains Mono'` (`font-variant-numeric: tabular-nums` for all live metrics)

---

## 5. Recommended Tech Stack & Project Layout

### Primary Choice: **Tauri v2 (Rust + WebView2 + React/TypeScript)**
- **Why**: Ultra-low footprint (`~15–30 MB` RAM using built-in Windows Edge WebView2), native Rust system tray & Windows APIs (`tray-icon`, `tauri-plugin-positioner`, `tauri-plugin-autostart`, `tauri-plugin-notification`, `tauri-plugin-single-instance`), plus easy UI parity with PiGradient's Tailwind/dark Material design.
- **Alternative**: **.NET 8 + WPF / WinUI 3 + `H.NotifyIcon`** if pure C#/XAML with zero WebView2 dependency is preferred.

### Suggested Repo Layout (Tauri v2)
```text
├── src-tauri/
│   ├── src/
│   │   ├── main.rs / lib.rs     # App bootstrap, single-instance lock, tray setup
│   │   ├── tray.rs              # Dynamic RGBA badge icon generator, tooltip formatter, context menu
│   │   ├── poller.rs            # Idle /api/v1/widget poller + active SSE stream + sleep/wake listener
│   │   ├── config.rs            # %APPDATA%\PiGradient\settings.json + HKCU Run autostart
│   │   └── commands.rs          # Tauri IPC commands (get/save settings, open dashboard, test LED)
│   ├── tauri.conf.json          # Borderless, skipTaskbar: true, transparent/dark rounded flyout
│   └── Cargo.toml
├── src/
│   ├── App.tsx                  # Flyout Shell (Widget View <-> Inline Settings View)
│   ├── components/
│   │   ├── WidgetTiles.tsx      # 4 compact KPI tiles (Air Quality, CO2, Climate, Chemical VOCs)
│   │   ├── MiniSparkline.tsx    # Lightweight SVG/Canvas 1h CO2 & PM2.5 sparkline
│   │   └── SettingsPanel.tsx    # Gateway URL, °F/°C, idle poll interval, Startup toggle, alert limits
│   └── types/telemetry.ts       # Exact PiGradient API types
└── .github/workflows/build-windows.yml
```

---

## 6. Windowing, Tray & Power-Efficiency Behavior

1. **Taskbar-Anchored Flyout Window (`~360 × 440 px`)**:
   - `decorations: false`, `skipTaskbar: true`, `alwaysOnTop: true`, `resizable: false`, `visible: false` at startup.
   - Positioned automatically above the tray icon (`tauri-plugin-positioner` `TrayCenter` / work-area clamped so it never clips off-screen or overlaps the taskbar regardless of taskbar position/DPI scaling).
   - Pressing `Esc` or losing focus (`WindowEvent::Focused(false)`) hides the flyout smoothly — **unless** the user clicks the **Pin** toggle in the flyout header.
2. **Dynamic Tray Icon & Tooltip**:
   - Render crisp `32×32` / `64×64` RGBA icon in Rust (e.g., PiGradient ring/dot colored by current `aqi_color` or `co2_category`, or muted slate `#64748B` when disconnected/unconfigured) — only regenerate/update the Win32 icon handle when the status/color band changes so GDI handles never leak.
   - Tooltip updated concisely (Windows tray tooltips cap at **127 chars**!):
     - Connected: `PiGradient · AQI 21 (Good) · CO₂ 612 ppm · 71.8°F · 45% RH`
     - Disconnected: `PiGradient · Monitor offline (last seen 4m ago)`
     - Unconfigured: `PiGradient · Right-click or click to set gateway URL`
3. **Two-Mode Fetching (Laptop Battery Friendly)**:
   - **Flyout Hidden (Idle)**: Poll `GET /api/v1/widget` every `15s`–`30s` (configurable) to keep tray badge, tooltip, and alert checks fresh with minimal CPU wakeups.
   - **Flyout Visible**: Switch to `GET /api/v1/stream` (`1 Hz` SSE) for instant real-time updates + fetch `1h` sparkline from `/api/v1/history`. Close SSE cleanly when flyout hides to avoid unnecessary background socket traffic.
4. **Windows Sleep / Resume & Network Recovery**:
   - Hook `WM_POWERBROADCAST` (`PBT_APMRESUMEAUTOMATIC`) or reconnect loop with short backoff (`2s -> 5s -> 15s`) so waking a laptop immediately refreshes `/api/v1/widget` instead of showing stale readings.
5. **Native Toast Alerts (Optional & Configurable)**:
   - Notify once when `CO₂ ≥ 1400 ppm` or `EPA AQI ≥ 101`, using hysteresis (`CO₂ < 1100`, `AQI < 85`) + cooldown (`30 min`) to prevent repeat spam.

---

## 7. Settings & Installer Pipeline
- **Settings File**: `%APPDATA%\PiGradient\settings.json`:
  - `gatewayUrl` (`""` initially until user sets `http://raspberrypi.local:8080` or IP)
  - `tempUnit` (`"f" | "c"`)
  - `idlePollSeconds` (`15` default)
  - `pinFlyout` (`false`)
  - `launchAtStartup` (`false` default, toggled via `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` — no admin UAC required)
  - `alertsEnabled`, `co2AlertThreshold`, `aqiAlertThreshold`
- **Build & Distribution**:
  - `tauri build` outputs both an **NSIS `.exe` installer** (per-user install without UAC) and an **`.msi` installer**.
  - CI workflow `.github/workflows/build-windows.yml` on `windows-latest` builds and uploads installers on `v*` tags.

---

## 8. Implementation Milestones
1. **Milestone 1 — Tray & Flyout Shell**: Tauri v2 scaffold, single-instance lock, tray context menu, DPI-aware taskbar-anchored borderless flyout, blur auto-hide + Pin button, and `%APPDATA%` settings store.
2. **Milestone 2 — Live Widget UI & Dynamic Tray Icon**: Rust idle `/api/v1/widget` poller + flyout-visible `1 Hz` SSE stream, 4 KPI tiles matching PiGradient colors/thresholds, `--` offline/unconfigured states, and crisp dynamic RGBA tray icon + `<=127`-char tooltip.
3. **Milestone 3 — Sparkline, Quick Controls & Power Handling**: 1h `/api/v1/history` sparkline, quick LED test (`PUT /api/v1/config`) & Day/Night toggle (`PUT /api/v1/schedule`), sleep/wake recovery, startup registry toggle, and Toast alerts.
4. **Milestone 4 — Windows Installer & CI**: NSIS/MSI bundle configuration, custom app icons (`.ico`), and `.github/workflows/build-windows.yml`.
