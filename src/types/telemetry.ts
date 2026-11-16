export interface AirGradientRaw {
  pm01: number;
  pm02: number;
  pm10: number;
  pm02_comp: number;
  rco2: number;
  atmp: number;
  atmp_comp: number;
  rhum: number;
  rhum_comp: number;
  tvoc_index: number;
  tvoc_raw: number;
  nox_index: number;
  nox_raw: number;
  boot_count?: number;
}

export interface DeviceInfo {
  serialno: string;
  firmware: string;
  model: string;
  wifi_rssi: number;
  boot_count: number;
}

export interface ProcessedTelemetry {
  aqi_pm25: number;
  aqi_category: 'Good' | 'Moderate' | 'Unhealthy for Sensitive Groups' | 'Unhealthy' | 'Very Unhealthy' | 'Hazardous';
  aqi_color: string;
  nowcast_aqi?: number;
  co2_level: string;
  co2_category: 'optimal' | 'fair' | 'poor' | 'critical';
  temp_f: number;
  temp_c: number;
  humidity: number;
  dew_point_c: number;
  dew_point_f: number;
  heat_index_c: number;
  heat_index_f: number;
}

export interface LiveTelemetryPayload {
  status: 'online' | 'degraded' | 'offline';
  is_simulated?: boolean;
  error_message?: string | null;
  last_seen_seconds_ago: number;
  timestamp: number;
  latency_ms: number;
  device?: DeviceInfo;
  raw: AirGradientRaw;
  processed: ProcessedTelemetry;
}

export interface HistoricalPoint {
  timestamp: number;
  pm02_comp: number;
  pm01?: number;
  pm10?: number;
  rco2: number;
  atmp_comp: number;
  rhum_comp: number;
  tvoc_index: number;
  nox_index: number;
}

// Exact AirGradient Local Server HTTP API (/config) schema
export interface DeviceConfig {
  country: string;
  pmStandard: 'ugm3' | 'us-aqi';
  ledBarMode: 'pm' | 'co2' | 'off';
  abcDays: number; // 0 (disabled), 8, 14, 30
  tvocLearningOffset: number; // hours: 12, 24, 48, 72, 168, 720
  noxLearningOffset: number; // hours: 12, 24, 48, 72, 168, 720
  mqttBrokerUrl: string;
  temperatureUnit: 'c' | 'f';
  configurationControl: 'local' | 'cloud' | 'both';
  postDataToAirGradient: boolean;
  disableCloudConnection: boolean;
  offlineMode: boolean;
  ledBarBrightness: number; // 0..100
  displayBrightness: number; // 0..100
  monitorDisplayCompensatedValues: boolean;
  model?: string; // Read-only from device GET /config
  corrections?: {
    pm02?: { correctionAlgorithm: string };
    temp?: { correctionAlgorithm: string; slr?: { intercept: number; scalingFactor: number } };
    rhum?: { correctionAlgorithm: string; slr?: { intercept: number; scalingFactor: number } };
  };
}

// PiGradient Raspberry Pi Daemon Automated Day/Night Scheduler (/api/v1/schedule)
export interface ScheduleConfig {
  enabled: boolean;
  dayTimeStart: string; // "08:00"
  dayTimeEnd: string;   // "22:00"
  ledBarBrightnessDay: number;
  ledBarBrightnessNight: number;
  displayBrightnessDay: number;
  displayBrightnessNight: number;
  displayNightLifetimeOff: boolean; // 02:00 - 03:00 screen off
}

export interface SystemStats {
  targetDeviceUrl: string;
  pollIntervalSec: number;
  collectorStatus: 'online' | 'degraded' | 'offline';
  consecutiveFailures: number;
  latencyMs: number;
  activePartition: string;
  dbSizeBytes: number;
  totalRecordsRecorded: number;
  uptimeSeconds: number;
  memoryMb: number;
  goroutines: number;
  simulatedMode: boolean;
  device?: DeviceInfo;
  // Archive storage health (reported by /api/v1/system)
  storageStatus?: 'ok' | 'degraded' | 'error';
  lastWriteError?: string;
  droppedRecords?: number;
  diskFreeBytes?: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
  component: string;
  message: string;
}
