# Self-Contained Build Plan: PiGradient Android App with Live Home-Screen Widgets

> **How to use this file**: Copy and paste the contents of this document directly into a brand-new coding session. It contains all context, backend API contracts, environmental thresholds, visual design tokens, and architecture decisions needed to build the companion Android app independently.

---

## 1. Project Context & Purpose
**PiGradient** is a self-hosted, local-LAN telemetry gateway running on a Raspberry Pi (default port `:8080`) that polls an **AirGradient ONE (I-9PSL)** indoor air quality monitor every `1 second`, archives telemetry into monthly SQLite WAL databases, and serves a REST + `1 Hz` Server-Sent Events (SSE) API.

Your task is to build the **PiGradient Companion Android App** featuring:
1. **Live Home-Screen Widgets (Jetpack Glance)**: Compact, glanceable widgets (`2×1`, `4×1`, `4×2`) showing live indoor air quality directly on the Android home screen.
2. **Mobile Companion UI (Jetpack Compose + Material 3)**: Real-time `1 Hz` SSE KPI view, historical time-series charts (`5m` to `30d`), quick hardware controls (LED bar mode, brightness, Day/Night schedule), and LAN gateway setup/discovery.

### Strict Behavioral Rules (Must Preserve)
- **Local-First & Zero Cloud**: Communicates strictly over the user's LAN (e.g., `http://raspberrypi.local:8080` or `http://192.168.1.x:8080`, or user-configured Tailscale/VPN host). Never add third-party analytics, ads, or cloud relays.
- **Zero Simulation or Spoofed Telemetry**: Never invent or pre-populate fake sensor readings (`0 ppm`, `"Good"`, fake serial numbers). When unconfigured, off-LAN (e.g., mobile data away from home), or when `timestamp <= 0`, display `--` placeholders, neutral slate `#475569` accents, and a clear `"Not Configured"` / `"Off LAN"` / `"Disconnected"` state.

---

## 2. PiGradient Backend API Contract (Already Implemented on Gateway)

Base URL is user-configured (default port `8080` on Raspberry Pi, or `http://localhost:8080` when testing against the Go daemon via `go run ./server/cmd/pigradient`). All JSON endpoints set CORS `*` and return `application/json`.

### A. `GET /api/v1/widget` (Primary Lightweight Widget Endpoint)
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
When no sensor reading has arrived yet (`timestamp <= 0`), the backend returns:
`{ "aqi": 0, "aqi_desc": "No Data", "aqi_color": "#64748B", "co2": 0, "temp": "--", "temp_c": "--", "humidity": "--", "updated": "--" }`.

### B. `GET /api/v1/live` & `GET /api/v1/stream` (`text/event-stream`, 1 Hz SSE)
SSE emits `data: <JSON>\n\n` every ~1 second (with `: keepalive\n\n` every ~25s) using the exact `/api/v1/live` payload:
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
- **Crucial Guard**: Treat `timestamp <= 0` as **No Telemetry Yet** (never render `0 AQI` / `"Good"` when `timestamp <= 0`).
- `status` is `"online" | "degraded" | "offline"`. `last_seen_seconds_ago` is `-1` if never polled successfully.

### C. `GET /api/v1/history?start=<unix>&end=<unix>&interval=<sec>`
Returns chronological array (or `[]` when empty):
```json
[
  {
    "timestamp": 1763247600,
    "pm01": 3.1,
    "pm02_comp": 5.1,
    "pm10": 6.8,
    "rco2": 612,
    "atmp_comp": 22.1,
    "rhum_comp": 45.0,
    "tvoc_index": 98,
    "nox_index": 1
  }
]
```
Recommended presets matching PiGradient web UI:
- `5m` (`interval=1`), `15m` (`interval=3`), `1h` (`interval=10`), `6h` (`interval=60`), `24h` (`interval=300`), `7d` (`interval=1800`), `30d` (`interval=7200`).

### D. `GET /api/v1/system` & `PUT /api/v1/system`
- `GET` returns `{ targetDeviceUrl, pollIntervalSec, collectorStatus, consecutiveFailures, latencyMs, activePartition, dbSizeBytes, totalRecordsRecorded, uptimeSeconds, memoryMb, goroutines, simulatedMode, device }`.
- `PUT` accepts `{ "targetUrl": "http://...", "pollSec": 1 }`.

### E. `GET /api/v1/config` & `PUT /api/v1/config`
Direct AirGradient Local NVS configuration keys:
- `ledBarMode`: `"pm" | "co2" | "off"`
- `ledBarBrightness`: `0..100`
- `displayBrightness`: `0..100`
- `temperatureUnit`: `"f" | "c"`
- `pmStandard`: `"ugm3" | "us-aqi"`
- `monitorDisplayCompensatedValues`: `boolean`
- `configurationControl`: `"local" | "cloud" | "both"`
- One-shot triggers via `PUT`: `{ "configurationControl": "local", "ledBarTestRequested": true }`

### F. `GET /api/v1/schedule` & `PUT /api/v1/schedule`
Day/Night automated dimming managed by Raspberry Pi daemon:
```json
{
  "enabled": true,
  "dayTimeStart": "08:00",
  "dayTimeEnd": "22:00",
  "ledBarBrightnessDay": 100,
  "ledBarBrightnessNight": 5,
  "displayBrightnessDay": 50,
  "displayBrightnessNight": 1,
  "displayNightLifetimeOff": true
}
```

---

## 3. Environmental Thresholds & Formulas (Exact Match)

| Metric | Rating / Thresholds | Color / Accent |
| :--- | :--- | :--- |
| **PM2.5 EPA AQI** | `0–50` Good (`0.0–12.0 µg/m³`), `51–100` Moderate (`12.1–35.4`), `101–150` Unhealthy for Sensitive Groups (`35.5–55.4`), `151–200` Unhealthy (`55.5–150.4`), `201–300` Very Unhealthy (`150.5–250.4`), `301–500` Hazardous (`250.5+`) | `#10B981`, `#F59E0B`, `#F97316`, `#EF4444`, `#8B5CF6`, `#7F1D1D` |
| **CO₂ (NDIR)** | `<800` Good (`optimal`), `800–999` Moderate (`fair`), `1000–1399` Elevated (`poor`), `≥1400` High (`critical`). Gauge range: `400–1800 ppm`. | Emerald `#10B981`, Amber `#F59E0B`, Orange `#F97316`, Rose `#F43F5E` |
| **TVOC / NOx (SGP41)** | Normal: `TVOC < 150 && NOx < 5`; Moderate: `TVOC ≥ 150 || NOx ≥ 5`; Elevated: `TVOC ≥ 250 || NOx ≥ 20`; High: `TVOC ≥ 400 || NOx ≥ 100` (`1–500` scale; baselines `TVOC=100`, `NOx=1`). | Emerald, Sky `#38BDF8`, Amber, Rose |
| **Comfort Guidelines** | Relative Humidity `30–60% RH`; ASHRAE Temp comfort max `76 °F` (`24.4 °C`); NWS Heat Alert `≥ 80 °F` (`26.7 °C`). | Cyan `#06B6D4`, Amber `#F59E0B` |

---

## 4. Visual Design Tokens
- **Theme**: Dark-first Material 3 matching PiGradient web console:
  - App Background: `#111318`
  - Card / Widget Surface: `#181B22` with `1dp` border `rgba(255, 255, 255, 0.08)` and `16dp` corner radius
  - Elevated Surface / Bar: `#14171D`
  - Primary Accent: `#2563EB` (action fills) / `#60A5FA` (text/icons)
  - Text Primary: `#FFFFFF` / `#E6E8EE`, Secondary: `#9CA3AF`, Muted: `#7E8596`
- **Typography**: System sans stack (`system-ui`) for headings & labels + `ui-monospace` / `Consolas` (tabular figures `fontFeatureSettings = "tnum"`) for all numeric telemetry values.

---

## 5. Recommended Android Tech Stack & Module Structure
- **Min SDK**: `26` (Android 8.0) | **Target/Compile SDK**: `35` | **Kotlin**: `2.0+`
- **Core Libraries**:
  - `androidx.compose.*` + `androidx.compose.material3`
  - `androidx.glance:glance-appwidget` + `androidx.glance:glance-material3`
  - `com.squareup.okhttp3:okhttp` + `com.squareup.okhttp3:okhttp-sse`
  - `org.jetbrains.kotlinx:kotlinx-serialization-json`
  - `androidx.work:work-runtime-ktx`
  - `androidx.datastore:datastore-preferences`
  - Charting: `Vico` (`com.patrykandpatrick.vico`) or lightweight custom Compose `Canvas`

### Suggested Package Layout (`app/src/main/java/com/pigradient/android/`)
```text
├── data/
│   ├── model/TelemetryModels.kt     # LivePayload, WidgetPayload, HistoryPoint, SystemStats, Config, Schedule
│   ├── network/PiGradientApi.kt     # OkHttp REST client + OkHttp EventSource SSE wrapper
│   ├── network/LanDiscovery.kt      # NsdManager (_http._tcp / mDNS) helper
│   └── prefs/SettingsRepository.kt  # DataStore (gatewayUrl, tempUnit, alertThresholds, liveWidgetMode)
├── domain/
│   └── EnvironmentAnalytics.kt      # AQI, CO2/VOC status helpers, offline/timestamp<=0 state guards
├── widget/
│   ├── PiGradientWidget.kt          # GlanceAppWidget supporting Compact (2x1), Standard (4x1), Detail (4x2)
│   ├── PiGradientWidgetReceiver.kt  # GlanceAppWidgetReceiver
│   ├── RefreshWidgetAction.kt       # Glance ActionCallback triggering immediate /api/v1/live fetch
│   └── WidgetSyncWorker.kt          # WorkManager (15m periodic + expedited refresh + alert notifications)
├── service/
│   └── LiveWidgetStreamService.kt   # Optional user-toggled Foreground Service (SSE -> 5s debounced widget updates)
└── ui/
    ├── theme/Theme.kt               # PiGradient dark tokens + tabular typography
    ├── monitor/MonitorScreen.kt     # 4 KPI cards, SSE status pill, 5m–30d trend chart
    ├── controls/ControlsScreen.kt   # LED mode, Day/Night schedule toggle, brightness sliders, LED test
    └── setup/GatewaySetupScreen.kt  # URL input, LAN scan, test connection, temp unit, alert settings
```

---

## 6. Home-Screen Widget Specifications (Jetpack Glance)

Use `SizeMode.Responsive` inside `PiGradientWidget` to cleanly adapt by widget bounds:

1. **Compact (`2×1`, ~110×40dp–180×100dp)**
   - Top color bar (`3dp` height) in `aqi_color` (or `#475569` if offline/`timestamp <= 0`)
   - Left: `AQI` large tabular number + `aqi_desc`
   - Right: `CO₂` ppm + `updated` time + small tap-to-refresh icon (`RefreshWidgetAction`)
2. **Standard (`4×1`, ~250×40dp–320×110dp)**
   - 4-column compact row matching PiGradient KPI cards:
     - **AQI / PM2.5**: `aqi_pm25` (`aqi_color`), `pm02_comp µg/m³`
     - **CO₂**: `rco2 ppm` + CO₂ status tint
     - **Climate**: `temp_f`/`temp_c` + `humidity%`
     - **VOCs**: `tvoc_index` / `nox_index` + `updated` & refresh button
3. **Detailed (`4×2`, ~250×110dp+)**
   - Everything in `4×1` plus:
     - Color-coded status labels (`Good`, `Moderate`, `Elevated`, `High`)
     - Sub-metrics row: `PM1`, `PM10`, `Dew Pt`, `Heat Idx`
     - Quick footer showing gateway status (`Online · 12ms` or `Off LAN · Last seen 14m ago`) + deep-link tap to open `MonitorScreen` or `ControlsScreen`.

---

## 7. Key Implementation Details & Edge Cases
1. **LAN Cleartext HTTP**:
   - Raspberry Pi gateways serve plain `http://` on local networks. Include `res/xml/network_security_config.xml` permitting cleartext HTTP (`cleartextTrafficPermitted="true"` — scoped cleanly for local/LAN configuration, with a clear UI note if connecting over untrusted networks).
2. **Refreshing Widgets Reliably on Android**:
   - Android enforces a `15 min` minimum for `PeriodicWorkRequest`.
   - Supplement `WorkManager` with:
     - Instant tap-to-refresh icon button on every widget (`ActionCallback` launching expedited sync).
     - Automatic widget state sync whenever the main app receives fresh `/api/v1/live` SSE frames.
     - An **opt-in** `"Live Home-Screen Mode"` toggle in Settings that runs a low-priority `ForegroundService` (`dataSync` type, Android 14+ compliant `FOREGROUND_SERVICE_DATA_SYNC`) listening to `/api/v1/stream` when on Wi-Fi and updating Glance state at most once every `5 seconds` (or only when displayed values change) to preserve battery.
3. **Off-LAN / Cellular Detection**:
   - Check `ConnectivityManager` transport; if on cellular without VPN or if gateway times out (`2.5s` connect/read timeout), immediately show cached `"Last seen Xm ago"` or `"Off LAN"` gracefully without blocking UI threads or draining battery retrying aggressively.
4. **Threshold Notifications**:
   - Optional local notifications (with hysteresis + configurable cooldown, default `30 min`) when `rco2 >= 1400` or `aqi_pm25 >= 101`.

---

## 8. Implementation Milestones
1. **Milestone 1 — Project Scaffold & Gateway Client**: Gradle setup (Compose + Glance + OkHttp + Serialization + WorkManager + DataStore), `network_security_config.xml`, models, `PiGradientApi`, and `GatewaySetupScreen` with `/api/v1/system` connection verification.
2. **Milestone 2 — Glance Widgets (`2×1`, `4×1`, `4×2`)**: `PiGradientWidget`, `WorkManager` 15m sync, `RefreshWidgetAction`, shared `GlanceStateDefinition` cache, and strict `--` offline/unconfigured rendering.
3. **Milestone 3 — Live App Dashboard & Controls**: `MonitorScreen` (`1 Hz` SSE + `5m–30d` `/api/v1/history` charts) and `ControlsScreen` (`/api/v1/config` & `/api/v1/schedule`).
4. **Milestone 4 — Optional Live Service, Alerts & CI**: Foreground Wi-Fi live stream option, threshold notifications, unit tests for AQI/CO₂/offline states, and GitHub Actions APK/AAB build workflow.
