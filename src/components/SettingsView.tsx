import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Moon,
  Sun,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Cpu,
  ShieldAlert,
  ExternalLink,
  Info,
  HelpCircle,
  Tv,
  Sparkles,
  Wifi,
  Terminal,
  Zap,
  Clock,
} from 'lucide-react';
import {
  DeviceConfig,
  ScheduleConfig,
  LiveTelemetryPayload,
  SystemStats,
} from '../types/telemetry';
import {
  MatButton,
  MatCard,
  MatCheckbox,
  MatDialog,
  MatDivider,
  MatSelect,
  MatSlider,
  MatSwitch,
  MatTabs,
  MatTabItem,
  MatTextField,
} from './material/MaterialUI';

interface SettingsViewProps {
  activeTab?: SettingsTab;
  onTabChange?: (tab: SettingsTab) => void;
  onRefreshConfig: () => Promise<void>;
  onUpdateTargetUrl: (url: string) => Promise<void>;
  isStreamConnected: boolean;
  telemetry: LiveTelemetryPayload | null;
  systemStats: SystemStats | null;
}

type SettingsTab = 'led_display' | 'calibration' | 'firmware' | 'connectivity';

const SETTINGS_TABS: MatTabItem[] = [
  {
    id: 'led_display',
    label: 'LED & Display',
    icon: <Tv className="w-4 h-4 hidden sm:inline" />,
    title: 'Configure front 9-LED bar, OLED display brightness, and automated Day/Night schedule',
  },
  {
    id: 'calibration',
    label: 'Calibration',
    icon: <Cpu className="w-4 h-4 hidden sm:inline" />,
    title: 'Configure CO₂ ABC window, SGP41 learning offsets, and EPA/linear compensation formulas',
  },
  {
    id: 'firmware',
    label: 'Firmware',
    icon: <Terminal className="w-4 h-4 hidden sm:inline" />,
    title: 'Inspect detected hardware model, firmware version, WiFi RSSI, and Local API support',
  },
  {
    id: 'connectivity',
    label: 'Connectivity',
    icon: <Wifi className="w-4 h-4 hidden sm:inline" />,
    title: 'Configure monitor LAN URL, MQTT broker, and AirGradient Cloud offline settings',
  },
];

const DEFAULT_DEVICE_CONFIG: DeviceConfig = {
  country: 'US',
  pmStandard: 'ugm3',
  ledBarMode: 'pm',
  abcDays: 8,
  tvocLearningOffset: 12,
  noxLearningOffset: 12,
  mqttBrokerUrl: '',
  temperatureUnit: 'f',
  configurationControl: 'local',
  postDataToAirGradient: false,
  disableCloudConnection: true,
  offlineMode: true,
  ledBarBrightness: 100,
  displayBrightness: 50,
  monitorDisplayCompensatedValues: true,
  model: '',
  corrections: {
    pm02: { correctionAlgorithm: 'epa_2021' },
    temp: {
      correctionAlgorithm: 'ag_pms5003t_default',
      slr: { intercept: -1.2, scalingFactor: 1.0 },
    },
    rhum: {
      correctionAlgorithm: 'ag_pms5003t_default',
      slr: { intercept: 3.0, scalingFactor: 1.0 },
    },
  },
};

const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  enabled: true,
  dayTimeStart: '08:00',
  dayTimeEnd: '22:00',
  ledBarBrightnessDay: 100,
  ledBarBrightnessNight: 5,
  displayBrightnessDay: 50,
  displayBrightnessNight: 1,
  displayNightLifetimeOff: true,
};

// Shared 9-LED Front Bar Preview (Matches AirGradient <app-monitor-leds> exact glow + opacity scaling)
const LedBarPreview: React.FC<{ brightness: number; mode: 'pm' | 'co2' | 'off' }> = ({
  brightness,
  mode,
}) => {
  const effectiveBrightness = mode === 'off' ? 0 : Math.max(0, Math.min(100, brightness));
  const ledColor = mode === 'co2' ? 'rgb(56, 189, 248)' : 'rgb(29, 226, 8)';
  const monitorOpacity =
    effectiveBrightness === 0 ? 0 : Math.max(0.03, effectiveBrightness / 100);

  return (
    <div
      className="p-3.5 bg-[#0f1116] border border-white/[0.08] rounded-lg flex items-center justify-center"
      title={`Front 9-LED bar preview (${mode.toUpperCase()} mode at ${effectiveBrightness}% brightness)`}
    >
      <div className="relative flex items-center gap-2.5 sm:gap-3.5">
        {Array.from({ length: 9 }).map((_, idx) => (
          <div
            key={idx}
            className="w-3.5 h-3.5 rounded-full bg-slate-800 relative overflow-visible"
          >
            <div
              className="w-full h-full rounded-full transition-opacity duration-150"
              style={{
                backgroundColor: ledColor,
                boxShadow: `${ledColor} 0px 0px 12px 2px`,
                opacity: monitorOpacity,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

// Shared AirGradient ONE Monochrome OLED Display Preview (True B/W vector OLED + dimming overlay)
const OledDisplayPreview: React.FC<{
  brightness: number;
  telemetry: LiveTelemetryPayload | null;
  tempUnit: 'c' | 'f';
  showCompensated: boolean;
}> = ({ brightness, telemetry, tempUnit, showCompensated }) => {
  const clamped = Math.max(0, Math.min(100, brightness));
  const overlayOpacity =
    clamped === 0 ? 0.96 : Math.round(0.75 * (1 - clamped / 100) * 1000) / 1000;

  const hasTelemetry = Boolean(telemetry && telemetry.timestamp > 0);
  const rawTempC = telemetry
    ? showCompensated
      ? telemetry.raw.atmp_comp
      : telemetry.raw.atmp
    : 0;
  const tempDisplay = hasTelemetry
    ? tempUnit === 'f'
      ? `${((rawTempC * 9) / 5 + 32).toFixed(1)} °F`
      : `${rawTempC.toFixed(1)} °C`
    : `-- °${tempUnit.toUpperCase()}`;
  const humVal = telemetry
    ? showCompensated
      ? telemetry.raw.rhum_comp
      : telemetry.raw.rhum
    : 0;
  const humDisplay = hasTelemetry ? `${Math.round(humVal)} %` : '-- %';
  const co2Display = hasTelemetry ? String(telemetry!.raw.rco2) : '--';
  const pmDisplay = hasTelemetry
    ? String(
        Math.round(showCompensated ? telemetry!.raw.pm02_comp : telemetry!.raw.pm02)
      )
    : '--';
  const tvocDisplay = hasTelemetry ? String(telemetry!.raw.tvoc_index) : '--';

  return (
    <div
      className="p-3.5 bg-[#0f1116] border border-white/[0.08] rounded-lg flex items-center justify-center"
      title={`AirGradient ONE monochrome B/W OLED preview (${clamped}% brightness${clamped === 0 ? ' — screen off' : ''})`}
    >
      <div className="relative w-44 rounded overflow-hidden border border-white/[0.18] bg-black select-none">
        <svg
          viewBox="0 0 260 140"
          role="img"
          aria-label="AirGradient ONE Monochrome OLED Display"
          className="w-full h-auto block"
          style={{ shapeRendering: 'geometricPrecision' }}
        >
          <rect width="260" height="140" fill="#000000" />

          {/* Top Row: Temperature & Relative Humidity */}
          <g
            fill="#ffffff"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontSize="22"
            fontWeight="500"
          >
            <text x="19" y="25">
              {tempDisplay}
            </text>
            <text x="236" y="25" textAnchor="end">
              {humDisplay}
            </text>
          </g>

          {/* Grid Dividers */}
          <g stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round">
            <line x1="20" y1="35" x2="240" y2="35" />
            <line x1="87" y1="35" x2="87" y2="127" />
            <line x1="176" y1="35" x2="176" y2="127" />
          </g>

          {/* Column 1: CO2 */}
          <g
            fill="#ffffff"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            <text x="9" y="61" fontSize="18" fontWeight="500">
              CO2
            </text>
            <text x="9" y="94" fontSize="27" fontWeight="700">
              {co2Display}
            </text>
            <text x="9" y="121" fontSize="19" fontWeight="500">
              ppm
            </text>
          </g>

          {/* Column 2: PM2.5 */}
          <g
            fill="#ffffff"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            <text x="97" y="61" fontSize="18" fontWeight="500">
              PM2.5
            </text>
            <text x="97" y="94" fontSize="27" fontWeight="700">
              {pmDisplay}
            </text>
            <text x="97" y="121" fontSize="19" fontWeight="500">
              ug/m
              <tspan dy="-6" fontSize="12.5" fontWeight="600">
                3
              </tspan>
            </text>
          </g>

          {/* Column 3: TVOC */}
          <g
            fill="#ffffff"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            <text x="186" y="61" fontSize="18" fontWeight="500">
              TVOC
            </text>
            <text x="186" y="94" fontSize="27" fontWeight="700">
              {tvocDisplay}
            </text>
            <text x="186" y="121" fontSize="19" fontWeight="500">
              idx
            </text>
          </g>
        </svg>

        {/* Unified AirGradient Brightness Attenuation Overlay */}
        <div
          className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-150"
          style={{ opacity: overlayOpacity }}
        />
      </div>
    </div>
  );
};

interface Pm02SlrConfig {
  intercept: number;
  scalingFactor: number;
  useEpa2021?: boolean;
}

interface Pm02CorrectionConfig {
  correctionAlgorithm: string;
  slr?: Pm02SlrConfig;
}

interface Pm25BatchPreset {
  name: string;
  scalingFactor: number;
  factorText: string;
}

// AirGradient KB batch linear regression correction factors (intercept 0)
const PM25_BATCH_PRESETS: Pm25BatchPreset[] = [
  { name: 'PMS5003_20231030', scalingFactor: 0.02838, factorText: '0.02838' },
  { name: 'PMS5003_20231218', scalingFactor: 0.03525, factorText: '0.03525' },
  { name: 'PMS5003_20240104', scalingFactor: 0.02896, factorText: '0.02896' },
  { name: 'PMS5003T_20240921', scalingFactor: 0.03343, factorText: '0.03343' },
  { name: 'PMS5003T_20240417', scalingFactor: 0.02799, factorText: '0.02799' },
  { name: 'PMS5003T_20240518', scalingFactor: 0.03394, factorText: '0.03394' },
  { name: 'PMS5003_20240826', scalingFactor: 0.03863, factorText: '0.03863' },
  { name: 'PMS5003_20250116', scalingFactor: 0.02983, factorText: '0.02983' },
  { name: 'PMS5003_20250530', scalingFactor: 0.02411, factorText: '0.02411' },
  { name: 'PMS5003T_20250208', scalingFactor: 0.02719, factorText: '0.02719' },
  { name: 'PMS5003T_20241222', scalingFactor: 0.0208, factorText: '0.02080' },
  { name: 'PMS5003_20250720', scalingFactor: 0.004629, factorText: '0.004629' },
  { name: 'PMS5003_20260225', scalingFactor: 0.004341, factorText: '0.004341' },
  { name: 'PMS5003_20260410', scalingFactor: 0.005152, factorText: '0.005152' },
  { name: 'PMS5003T_20260408', scalingFactor: 0.003964, factorText: '0.003964' },
  { name: 'PMS5003_20251218', scalingFactor: 0.016522, factorText: '0.016522' },
  { name: 'PMS5003_20260108', scalingFactor: 0.014934, factorText: '0.014934' },
  { name: 'PMS5003_20260617', scalingFactor: 0.00508, factorText: '0.005080' },
  { name: 'PMS5003T_20260923', scalingFactor: 0.00449, factorText: '0.004490' },
];

function formatPmReadbackLine(pm: Pm02CorrectionConfig | null): string {
  if (!pm) return 'Monitor reports: unavailable (could not reach /config)';
  const algo = pm.correctionAlgorithm || 'none';
  if (!pm.slr) return `Monitor reports: ${algo}`;
  const factor = typeof pm.slr.scalingFactor === 'number' ? pm.slr.scalingFactor : '--';
  const offset = typeof pm.slr.intercept === 'number' ? pm.slr.intercept : 0;
  const epa = pm.slr.useEpa2021 === false ? 'EPA off' : 'EPA on';
  return `Monitor reports: ${algo} · factor ${factor} · offset ${offset} · ${epa}`;
}

function describeModel(modelCode?: string): string {
  if (!modelCode) return 'No monitor detected';
  if (modelCode === 'I-9PSL' || modelCode.startsWith('I-9PSL-')) {
    return `AirGradient ONE (${modelCode})`;
  }
  if (modelCode === 'O-1PST' || modelCode.startsWith('O-1PST-')) {
    return `AirGradient Open Air (${modelCode})`;
  }
  if (modelCode === 'I-1DIY') return 'AirGradient DIY';
  return `AirGradient (${modelCode})`;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  activeTab: controlledTab,
  onTabChange,
  onRefreshConfig,
  onUpdateTargetUrl,
  isStreamConnected,
  telemetry,
  systemStats,
}) => {
  const [localTab, setLocalTab] = useState<SettingsTab>('led_display');
  const activeTab = controlledTab ?? localTab;
  const setActiveTab = (tab: SettingsTab) => {
    setLocalTab(tab);
    onTabChange?.(tab);
  };
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [reportedPm02, setReportedPm02] = useState<Pm02CorrectionConfig | null>(null);
  const [pmScaleText, setPmScaleText] = useState<string>('1');
  const [pmOffsetText, setPmOffsetText] = useState<string>('0');
  const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE_CONFIG);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingDevice, setSavingDevice] = useState<boolean>(false);
  const [savingSchedule, setSavingSchedule] = useState<boolean>(false);
  const [savingTarget, setSavingTarget] = useState<boolean>(false);
  const [testingLed, setTestingLed] = useState<boolean>(false);
  const [targetInput, setTargetInput] = useState<string>(
    systemStats?.targetDeviceUrl || ''
  );
  const [saveStatus, setSaveStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const [manualCalibModal, setManualCalibModal] = useState<boolean>(false);
  const [outdoorConfirmed, setOutdoorConfirmed] = useState<boolean>(false);
  const [showLedInfoModal, setShowLedInfoModal] = useState<boolean>(false);

  const detectedDevice = telemetry?.device ?? systemStats?.device;

  useEffect(() => {
    if (systemStats?.targetDeviceUrl) {
      setTargetInput(systemStats.targetDeviceUrl);
    }
  }, [systemStats?.targetDeviceUrl]);

  useEffect(() => {
    loadAllSettings();
  }, []);

  const readErrorMessage = async (res: Response) => {
    try {
      const body = await res.json();
      if (body?.error) return String(body.error);
    } catch {}
    return `HTTP ${res.status}`;
  };

  const applyLoadedConfig = (data: DeviceConfig) => {
    const loadedPm02 = (data.corrections?.pm02 as Pm02CorrectionConfig | undefined) ?? null;
    setReportedPm02(loadedPm02);
    setConfig({
      ...DEFAULT_DEVICE_CONFIG,
      ...data,
      corrections: {
        ...DEFAULT_DEVICE_CONFIG.corrections,
        ...(data.corrections || {}),
      },
    });
    const scaleVal = loadedPm02?.slr?.scalingFactor;
    const offsetVal = loadedPm02?.slr?.intercept;
    setPmScaleText(typeof scaleVal === 'number' ? String(scaleVal) : '1');
    setPmOffsetText(typeof offsetVal === 'number' ? String(offsetVal) : '0');
  };

  const refreshConfigFromDevice = async () => {
    try {
      const cfgRes = await fetch(`${import.meta.env.BASE_URL}api/v1/config`);
      if (cfgRes.ok) {
        const data: DeviceConfig = await cfgRes.json();
        applyLoadedConfig(data);
      }
    } catch {
      // Non-fatal post-save readback skip; existing status banner remains visible
    }
  };

  const loadAllSettings = async () => {
    setLoading(true);
    try {
      const [cfgRes, schedRes] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}api/v1/config`),
        fetch(`${import.meta.env.BASE_URL}api/v1/schedule`),
      ]);

      if (cfgRes.ok) {
        const data: DeviceConfig = await cfgRes.json();
        applyLoadedConfig(data);
      } else {
        setConfig((prev) => prev ?? DEFAULT_DEVICE_CONFIG);
        setSaveStatus({
          type: 'error',
          message: `Could not read /config from AirGradient monitor (${await readErrorMessage(cfgRes)}). Verify the monitor URL in Connectivity.`,
        });
      }
      if (schedRes.ok) {
        const sData = await schedRes.json();
        setSchedule({ ...DEFAULT_SCHEDULE_CONFIG, ...sData });
      }
    } catch {
      setConfig((prev) => prev ?? DEFAULT_DEVICE_CONFIG);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDeviceNvs = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!config) return;

    const curPm = config.corrections?.pm02 as Pm02CorrectionConfig | undefined;
    const curPmAlgo = curPm?.correctionAlgorithm || 'none';
    let nextPm02Payload: Pm02CorrectionConfig;

    if (curPmAlgo === 'none' || curPmAlgo === 'epa_2021') {
      nextPm02Payload = { correctionAlgorithm: curPmAlgo };
    } else if (curPmAlgo === 'custom' || curPmAlgo.startsWith('slr_')) {
      const parsedScale = Number(pmScaleText.trim());
      const parsedOffset = Number(pmOffsetText.trim());
      if (curPmAlgo === 'custom') {
        if (
          pmScaleText.trim() === '' ||
          !Number.isFinite(parsedScale) ||
          parsedScale <= 0 ||
          parsedScale > 10
        ) {
          setSaveStatus({
            type: 'error',
            message: 'PM2.5 Scaling Factor must be greater than 0 and at most 10.',
          });
          return;
        }
        if (
          pmOffsetText.trim() === '' ||
          !Number.isFinite(parsedOffset) ||
          parsedOffset < -100 ||
          parsedOffset > 100
        ) {
          setSaveStatus({
            type: 'error',
            message: 'PM2.5 Offset must be between -100 and 100.',
          });
          return;
        }
      }
      const scaleToSend =
        curPmAlgo === 'custom'
          ? parsedScale
          : typeof curPm?.slr?.scalingFactor === 'number' &&
            curPm.slr.scalingFactor > 0 &&
            curPm.slr.scalingFactor <= 10
          ? curPm.slr.scalingFactor
          : 1;
      const offsetToSend =
        curPmAlgo === 'custom'
          ? parsedOffset
          : typeof curPm?.slr?.intercept === 'number' &&
            curPm.slr.intercept >= -100 &&
            curPm.slr.intercept <= 100
          ? curPm.slr.intercept
          : 0;
      nextPm02Payload = {
        correctionAlgorithm: curPmAlgo,
        slr: {
          intercept: offsetToSend,
          scalingFactor: scaleToSend,
          useEpa2021: curPm?.slr?.useEpa2021 ?? true,
        },
      };
    } else if (curPmAlgo.startsWith('slr_') && !curPm?.slr) {
      // Unknown/unmatched slr_<batch> with no SLR object in the read-back:
      // forward the section untouched rather than fabricating defaults that
      // would overwrite device-side SLR values the GET never surfaced.
      nextPm02Payload = { correctionAlgorithm: curPmAlgo };
    } else {
      nextPm02Payload = {
        correctionAlgorithm: curPmAlgo,
        ...(curPm?.slr ? { slr: { ...curPm.slr } } : {}),
      };
    }

    setSavingDevice(true);
    setSaveStatus(null);

    try {
      const payload: Partial<DeviceConfig> = {
        ...config,
        configurationControl: config.configurationControl || 'local',
        corrections: {
          ...config.corrections,
          pm02: nextPm02Payload as NonNullable<DeviceConfig['corrections']>['pm02'],
        },
      };
      if (schedule.enabled) {
        delete payload.ledBarBrightness;
        delete payload.displayBrightness;
      }
      const res = await fetch(`${import.meta.env.BASE_URL}api/v1/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSaveStatus({
          type: 'success',
          message:
            'Device NVS settings written via PUT /config directly to AirGradient flash.',
        });
        await Promise.all([onRefreshConfig(), refreshConfigFromDevice()]);
      } else {
        throw new Error(await readErrorMessage(res));
      }
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        message: `Failed writing to AirGradient /config: ${err.message}`,
      });
    } finally {
      setSavingDevice(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/v1/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      if (res.ok) {
        setSaveStatus({
          type: 'success',
          message: schedule.enabled
            ? 'PiGradient Day/Night schedule saved on Raspberry Pi and current phase brightness pushed to monitor.'
            : 'PiGradient Day/Night schedule disabled. Monitor uses manual NVS brightness values.',
        });
        await loadAllSettings();
      } else {
        throw new Error(await readErrorMessage(res));
      }
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        message: `Failed saving schedule: ${err.message}`,
      });
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleTriggerLedTest = async () => {
    setTestingLed(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/v1/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configurationControl: 'local',
          ledBarTestRequested: true,
        }),
      });
      if (res.ok) {
        setSaveStatus({
          type: 'success',
          message:
            'Sent ledBarTestRequested: true to monitor — 9-LED bar test sequence triggered.',
        });
      } else {
        throw new Error(await readErrorMessage(res));
      }
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        message: `LED bar test failed: ${err.message}`,
      });
    } finally {
      setTestingLed(false);
    }
  };

  const executeManual400PpmReset = async () => {
    try {
      setSavingDevice(true);
      const res = await fetch(`${import.meta.env.BASE_URL}api/v1/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configurationControl: 'local',
          co2CalibrationRequested: true,
        }),
      });

      if (res.ok) {
        setSaveStatus({
          type: 'success',
          message:
            'Sent co2CalibrationRequested: true via PUT /config — monitor NDIR 400 ppm baseline calibration started.',
        });
        setManualCalibModal(false);
        setOutdoorConfirmed(false);
      } else {
        throw new Error(await readErrorMessage(res));
      }
    } catch (err: any) {
      setSaveStatus({
        type: 'error',
        message: `Calibration command failed: ${err.message}`,
      });
    } finally {
      setSavingDevice(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] text-[#9ca3af]">
        <RefreshCw className="w-6 h-6 animate-spin text-[#60a5fa]" />
        <span className="text-sm ml-2.5">Querying AirGradient device /config...</span>
      </div>
    );
  }

  const tempIntercept = config.corrections?.temp?.slr?.intercept ?? -1.2;
  const rhumIntercept = config.corrections?.rhum?.slr?.intercept ?? 3.0;
  const pmConfig = config.corrections?.pm02 as Pm02CorrectionConfig | undefined;
  const pmAlgorithm = pmConfig?.correctionAlgorithm || 'none';
  const pmUseEpa2021 = pmConfig?.slr?.useEpa2021 ?? true;
  const pmActiveScale = pmConfig?.slr?.scalingFactor;
  const pmActiveOffset = pmConfig?.slr?.intercept ?? 0;
  const tempAlgo = config.corrections?.temp?.correctionAlgorithm ?? 'ag_pms5003t_default';
  const rhumAlgo = config.corrections?.rhum?.correctionAlgorithm ?? 'ag_pms5003t_default';

  const parsedPmScale = Number(pmScaleText.trim());
  const pmScaleError =
    pmAlgorithm !== 'custom'
      ? null
      : pmScaleText.trim() === '' || !Number.isFinite(parsedPmScale)
      ? 'Enter a valid numeric scaling factor.'
      : parsedPmScale <= 0 || parsedPmScale > 10
      ? 'Scaling factor must be > 0 and ≤ 10.'
      : null;

  const parsedPmOffset = Number(pmOffsetText.trim());
  const pmOffsetError =
    pmAlgorithm !== 'custom'
      ? null
      : pmOffsetText.trim() === '' || !Number.isFinite(parsedPmOffset)
      ? 'Enter a valid numeric offset.'
      : parsedPmOffset < -100 || parsedPmOffset > 100
      ? 'Offset must be between -100 and 100.'
      : null;

  const hasKnownPmPreset = PM25_BATCH_PRESETS.some(
    (p) => `slr_${p.name}` === pmAlgorithm
  );
  const isExplicitPmOption =
    hasKnownPmPreset ||
    pmAlgorithm === 'custom' ||
    pmAlgorithm === 'epa_2021' ||
    pmAlgorithm === 'none';

  const pmSelectOptions: { value: string; label: string }[] = [
    ...(!isExplicitPmOption
      ? [
          {
            value: pmAlgorithm,
            label: `${pmAlgorithm} (reported by monitor)`,
          },
        ]
      : []),
    ...PM25_BATCH_PRESETS.map((p) => ({
      value: `slr_${p.name}`,
      label: `${p.name} (${p.factorText})`,
    })),
    { value: 'custom', label: 'Custom' },
    { value: 'epa_2021', label: 'EPA 2021 (humidity-compensated raw)' },
    { value: 'none', label: 'None' },
  ];

  const handlePmPresetChange = (nextAlgo: string) => {
    const curPm = pmConfig;
    const keepEpa = curPm?.slr?.useEpa2021 ?? true;

    if (nextAlgo === 'none' || nextAlgo === 'epa_2021') {
      const nextPm02: Pm02CorrectionConfig = {
        correctionAlgorithm: nextAlgo,
        ...(curPm?.slr ? { slr: { ...curPm.slr } } : {}),
      };
      setConfig({
        ...config,
        corrections: {
          ...config.corrections,
          pm02: nextPm02 as NonNullable<DeviceConfig['corrections']>['pm02'],
        },
      });
      return;
    }

    if (nextAlgo === 'custom') {
      const fallbackScale =
        typeof curPm?.slr?.scalingFactor === 'number' &&
        curPm.slr.scalingFactor > 0 &&
        curPm.slr.scalingFactor <= 10
          ? curPm.slr.scalingFactor
          : 1;
      const fallbackOffset =
        typeof curPm?.slr?.intercept === 'number' &&
        curPm.slr.intercept >= -100 &&
        curPm.slr.intercept <= 100
          ? curPm.slr.intercept
          : 0;
      const nextPm02: Pm02CorrectionConfig = {
        correctionAlgorithm: 'custom',
        slr: {
          intercept: fallbackOffset,
          scalingFactor: fallbackScale,
          useEpa2021: keepEpa,
        },
      };
      setPmScaleText(String(fallbackScale));
      setPmOffsetText(String(fallbackOffset));
      setConfig({
        ...config,
        corrections: {
          ...config.corrections,
          pm02: nextPm02 as NonNullable<DeviceConfig['corrections']>['pm02'],
        },
      });
      return;
    }

    const preset = PM25_BATCH_PRESETS.find((p) => `slr_${p.name}` === nextAlgo);
    const nextScale = preset
      ? preset.scalingFactor
      : typeof curPm?.slr?.scalingFactor === 'number' && curPm.slr.scalingFactor > 0
      ? curPm.slr.scalingFactor
      : 1;
    const nextPm02: Pm02CorrectionConfig = {
      correctionAlgorithm: nextAlgo,
      slr: {
        intercept: preset ? 0 : curPm?.slr?.intercept ?? 0,
        scalingFactor: nextScale,
        useEpa2021: keepEpa,
      },
    };
    setPmScaleText(preset ? preset.factorText : String(nextScale));
    setPmOffsetText(preset ? '0' : String(nextPm02.slr?.intercept ?? 0));
    setConfig({
      ...config,
      corrections: {
        ...config.corrections,
        pm02: nextPm02 as NonNullable<DeviceConfig['corrections']>['pm02'],
      },
    });
  };

  const handlePmUseEpaChange = (checked: boolean) => {
    // In none/epa_2021 modes no slr object is ever sent (the save path strips
    // it), so ignore toggles there to keep checkbox state and payload in sync.
    if (pmAlgorithm === 'none' || pmAlgorithm === 'epa_2021') {
      return;
    }
    const preset = PM25_BATCH_PRESETS.find((p) => `slr_${p.name}` === pmAlgorithm);
    const currentScale =
      typeof pmConfig?.slr?.scalingFactor === 'number' && pmConfig.slr.scalingFactor > 0
        ? pmConfig.slr.scalingFactor
        : preset
        ? preset.scalingFactor
        : 1;
    const currentOffset =
      typeof pmConfig?.slr?.intercept === 'number' ? pmConfig.slr.intercept : 0;

    const nextPm02: Pm02CorrectionConfig = {
      correctionAlgorithm: pmAlgorithm,
      slr: {
        intercept: currentOffset,
        scalingFactor: currentScale,
        useEpa2021: checked,
      },
    };
    setConfig({
      ...config,
      corrections: {
        ...config.corrections,
        pm02: nextPm02 as NonNullable<DeviceConfig['corrections']>['pm02'],
      },
    });
  };

  const handlePmScaleTextChange = (raw: string) => {
    setPmScaleText(raw);
    const parsed = Number(raw.trim());
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed <= 0 || parsed > 10) {
      return;
    }
    const nextPm02: Pm02CorrectionConfig = {
      correctionAlgorithm: 'custom',
      slr: {
        intercept:
          typeof pmConfig?.slr?.intercept === 'number' ? pmConfig.slr.intercept : 0,
        scalingFactor: parsed,
        useEpa2021: pmUseEpa2021,
      },
    };
    setConfig({
      ...config,
      corrections: {
        ...config.corrections,
        pm02: nextPm02 as NonNullable<DeviceConfig['corrections']>['pm02'],
      },
    });
  };

  const handlePmOffsetTextChange = (raw: string) => {
    setPmOffsetText(raw);
    const parsed = Number(raw.trim());
    if (raw.trim() === '' || !Number.isFinite(parsed) || parsed < -100 || parsed > 100) {
      return;
    }
    const nextPm02: Pm02CorrectionConfig = {
      correctionAlgorithm: 'custom',
      slr: {
        intercept: parsed,
        scalingFactor:
          typeof pmConfig?.slr?.scalingFactor === 'number' &&
          pmConfig.slr.scalingFactor > 0
            ? pmConfig.slr.scalingFactor
            : 1,
        useEpa2021: pmUseEpa2021,
      },
    };
    setConfig({
      ...config,
      corrections: {
        ...config.corrections,
        pm02: nextPm02 as NonNullable<DeviceConfig['corrections']>['pm02'],
      },
    });
  };

  return (
    <div className="space-y-4 sm:space-y-5 max-w-4xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
      {/* Hardware Overview Card */}
      <MatCard className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#60a5fa] shrink-0" aria-hidden="true" />
            <h1 className="text-sm sm:text-base font-semibold text-white tracking-tight font-display truncate">
              Device Controls &amp; NVS Settings
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#9ca3af] mt-1 font-mono">
            <span className="font-sans" title="Detected AirGradient monitor hardware model">
              {describeModel(config.model || detectedDevice?.model)}
            </span>
            <span aria-hidden="true">·</span>
            <span title="Installed AirGradient ESP32 firmware version">
              {detectedDevice?.firmware ? `fw v${detectedDevice.firmware}` : 'fw --'}
            </span>
            {detectedDevice?.serialno && (
              <>
                <span aria-hidden="true">·</span>
                <span title="Hardware serial number / mDNS host identifier">
                  SN {detectedDevice.serialno}
                </span>
              </>
            )}
          </div>
        </div>

        <MatButton
          variant="outlined"
          size="sm"
          onClick={loadAllSettings}
          title="Re-query GET /config and schedule state from monitor"
          className="w-full sm:w-auto"
          icon={<RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
        >
          Query Device
        </MatButton>
      </MatCard>

      {saveStatus && (
        <div
          role={saveStatus.type === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`px-4 py-3 rounded-xl border flex items-center gap-3 text-xs ${
            saveStatus.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {saveStatus.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
          )}
          <span>{saveStatus.message}</span>
        </div>
      )}

      {/* Material Tabs with Bottom Ink Bar */}
      <MatTabs
        ariaLabel="Device settings sections"
        tabs={SETTINGS_TABS}
        value={activeTab}
        onChange={(id) => setActiveTab(id as SettingsTab)}
        fullWidth
      />

      {/* TAB 1: LED & DISPLAY */}
      {activeTab === 'led_display' && (
        <div className="space-y-5">
          {/* Card A: Real Monitor NVS Controls (PUT /config) */}
          <MatCard className="p-4 sm:p-6">
            <form onSubmit={handleSaveDeviceNvs} className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
                    <h2 className="text-sm font-semibold text-white font-display">
                      Monitor LED &amp; OLED Settings
                    </h2>
                  </div>
                  <p className="text-xs text-[#8f96a6] mt-0.5">
                    Saved directly to AirGradient flash via local NVS configuration.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 shrink-0">
                  <MatButton
                    variant="text"
                    size="sm"
                    onClick={() => setShowLedInfoModal(true)}
                    title="Explain how PM2.5, CO₂, and Off LED bar modes work"
                    icon={<HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    LED Modes
                  </MatButton>
                  <MatButton
                    variant="outlined"
                    size="sm"
                    disabled={testingLed}
                    onClick={handleTriggerLedTest}
                    title="Send ledBarTestRequested: true to flash the 9 front LEDs"
                    icon={<Zap className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />}
                  >
                    {testingLed ? 'Testing...' : 'Test LEDs'}
                  </MatButton>
                </div>
              </div>

              <MatDivider />

              {/* Material Selectors */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <MatSelect
                  label="LED Bar Mode"
                  value={config.ledBarMode}
                  onChange={(v) => setConfig({ ...config, ledBarMode: v as any })}
                  options={[
                    { value: 'pm', label: 'PM2.5 Color Scale' },
                    { value: 'co2', label: 'CO₂ Thresholds' },
                    { value: 'off', label: 'LEDs Disabled' },
                  ]}
                />

                <MatSelect
                  label="Device Screen Unit"
                  value={config.temperatureUnit}
                  onChange={(v) => setConfig({ ...config, temperatureUnit: v as any })}
                  options={[
                    { value: 'f', label: 'Fahrenheit (°F)' },
                    { value: 'c', label: 'Celsius (°C)' },
                  ]}
                />

                <MatSelect
                  label="PM Display Standard"
                  value={config.pmStandard}
                  onChange={(v) => setConfig({ ...config, pmStandard: v as any })}
                  options={[
                    { value: 'ugm3', label: 'µg/m³ Concentration' },
                    { value: 'us-aqi', label: 'US AQI Scale' },
                  ]}
                />
              </div>

              <MatDivider />

              <MatSwitch
                checked={config.monitorDisplayCompensatedValues}
                onChange={(checked) =>
                  setConfig({ ...config, monitorDisplayCompensatedValues: checked })
                }
                label="Display Compensated Values on OLED"
                description="Shows EPA-corrected PM2.5 and heat-compensated temperature and humidity on the screen."
              />

              {/* Direct NVS Brightness Sliders (active when Pi Schedule is disabled) */}
              {!schedule.enabled && (
                <>
                  <MatDivider />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-medium text-[#e6e8ee]">
                        <span>LED Bar Brightness</span>
                        <span className="font-mono tabular-nums text-emerald-400">
                          {config.ledBarBrightness}%
                        </span>
                      </div>
                      <LedBarPreview
                        brightness={config.ledBarBrightness}
                        mode={config.ledBarMode}
                      />
                      <MatSlider
                        ariaLabel="LED Bar Brightness"
                        value={config.ledBarBrightness}
                        onChange={(v) => setConfig({ ...config, ledBarBrightness: v })}
                        color="emerald"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs font-medium text-[#e6e8ee]">
                        <span>OLED Display Brightness</span>
                        <span className="font-mono tabular-nums text-[#60a5fa]">
                          {config.displayBrightness}%
                        </span>
                      </div>
                      <OledDisplayPreview
                        brightness={config.displayBrightness}
                        telemetry={telemetry}
                        tempUnit={config.temperatureUnit}
                        showCompensated={config.monitorDisplayCompensatedValues}
                      />
                      <MatSlider
                        ariaLabel="OLED Display Brightness"
                        value={config.displayBrightness}
                        onChange={(v) => setConfig({ ...config, displayBrightness: v })}
                        color="primary"
                      />
                    </div>
                  </div>
                </>
              )}

              <MatDivider />

              <div className="flex justify-end">
                <MatButton
                  type="submit"
                  variant="filled"
                  disabled={savingDevice}
                  className="w-full sm:w-auto"
                  icon={
                    savingDevice ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined
                  }
                >
                  Save Settings to Monitor
                </MatButton>
              </div>
            </form>
          </MatCard>

          {/* Card B: PiGradient Automated Day/Night Scheduler (/api/v1/schedule) */}
          <MatCard className="p-4 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-indigo-400 shrink-0" />
                  <h2 className="text-sm font-semibold text-white font-display">
                    Automated Day &amp; Night Dimming Schedule
                  </h2>
                </div>
                <p className="text-xs text-[#8f96a6] mt-1 max-w-2xl leading-relaxed">
                  Managed by your Raspberry Pi daemon — automatically pushes Day and Night
                  brightness presets to the monitor on schedule.
                </p>
              </div>

              <div className="shrink-0">
                <MatSwitch
                  checked={schedule.enabled}
                  onChange={(checked) => setSchedule({ ...schedule, enabled: checked })}
                  label="Enable Schedule"
                  className="!py-0"
                />
              </div>
            </div>

            {schedule.enabled && (
              <>
                <MatDivider />

                {/* Schedule Hours */}
                <div className="grid grid-cols-2 gap-3 sm:gap-5 max-w-lg">
                  <MatTextField
                    type="time"
                    mono
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Sun className="w-3.5 h-3.5 text-amber-400" />
                        <span>Day Start</span>
                      </span>
                    }
                    value={schedule.dayTimeStart}
                    onChange={(v) => setSchedule({ ...schedule, dayTimeStart: v })}
                  />

                  <MatTextField
                    type="time"
                    mono
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <Moon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Night Start</span>
                      </span>
                    }
                    value={schedule.dayTimeEnd}
                    onChange={(v) => setSchedule({ ...schedule, dayTimeEnd: v })}
                  />
                </div>

                <MatDivider />

                {/* LED Brightness Day & Night (Identical Preview Component) */}
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-[#9ca3af]">LED Bar Brightness</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-[#e6e8ee]">
                          <Sun className="w-3.5 h-3.5 text-amber-400" />
                          Day Time
                        </span>
                        <span className="font-mono tabular-nums text-emerald-400 font-semibold">
                          {schedule.ledBarBrightnessDay}%
                        </span>
                      </div>
                      <LedBarPreview
                        brightness={schedule.ledBarBrightnessDay}
                        mode={config.ledBarMode}
                      />
                      <MatSlider
                        ariaLabel="Day Time LED Brightness"
                        value={schedule.ledBarBrightnessDay}
                        onChange={(v) =>
                          setSchedule({ ...schedule, ledBarBrightnessDay: v })
                        }
                        color="emerald"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-[#e6e8ee]">
                          <Moon className="w-3.5 h-3.5 text-indigo-400" />
                          Night Time
                        </span>
                        <span className="font-mono tabular-nums text-indigo-400 font-semibold">
                          {schedule.ledBarBrightnessNight}%
                        </span>
                      </div>
                      <LedBarPreview
                        brightness={schedule.ledBarBrightnessNight}
                        mode={config.ledBarMode}
                      />
                      <MatSlider
                        ariaLabel="Night Time LED Brightness"
                        value={schedule.ledBarBrightnessNight}
                        onChange={(v) =>
                          setSchedule({ ...schedule, ledBarBrightnessNight: v })
                        }
                        color="indigo"
                      />
                    </div>
                  </div>
                </div>

                <MatDivider />

                {/* OLED Display Brightness Day & Night (Identical Preview Component) */}
                <div className="space-y-4">
                  <h3 className="text-xs font-semibold text-[#9ca3af]">
                    OLED Display Brightness
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-[#e6e8ee]">
                          <Sun className="w-3.5 h-3.5 text-amber-400" />
                          Day Time
                        </span>
                        <span className="font-mono tabular-nums text-[#60a5fa] font-semibold">
                          {schedule.displayBrightnessDay}%
                        </span>
                      </div>
                      <OledDisplayPreview
                        brightness={schedule.displayBrightnessDay}
                        telemetry={telemetry}
                        tempUnit={config.temperatureUnit}
                        showCompensated={config.monitorDisplayCompensatedValues}
                      />
                      <MatSlider
                        ariaLabel="Day Time OLED Brightness"
                        value={schedule.displayBrightnessDay}
                        onChange={(v) =>
                          setSchedule({ ...schedule, displayBrightnessDay: v })
                        }
                        color="primary"
                      />
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 font-medium text-[#e6e8ee]">
                          <Moon className="w-3.5 h-3.5 text-indigo-400" />
                          Night Time
                        </span>
                        <span className="font-mono tabular-nums text-indigo-400 font-semibold">
                          {schedule.displayBrightnessNight}%
                        </span>
                      </div>
                      <OledDisplayPreview
                        brightness={schedule.displayBrightnessNight}
                        telemetry={telemetry}
                        tempUnit={config.temperatureUnit}
                        showCompensated={config.monitorDisplayCompensatedValues}
                      />
                      <MatSlider
                        ariaLabel="Night Time OLED Brightness"
                        value={schedule.displayBrightnessNight}
                        onChange={(v) =>
                          setSchedule({ ...schedule, displayBrightnessNight: v })
                        }
                        color="indigo"
                      />
                    </div>
                  </div>

                  <MatDivider />

                  <MatSwitch
                    checked={schedule.displayNightLifetimeOff}
                    onChange={(checked) =>
                      setSchedule({ ...schedule, displayNightLifetimeOff: checked })
                    }
                    label="Turn off OLED from 2:00 AM to 3:00 AM nightly"
                    description="Sets display brightness to 0% during this hour to reduce OLED burn-in."
                  />
                </div>
              </>
            )}

            <MatDivider />

            <div className="flex justify-end">
              <MatButton
                variant="tonal"
                disabled={savingSchedule}
                onClick={handleSaveSchedule}
                className="w-full sm:w-auto"
                icon={
                  savingSchedule ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : undefined
                }
              >
                Save Schedule on Pi
              </MatButton>
            </div>
          </MatCard>
        </div>
      )}

      {/* TAB 2: CALIBRATION */}
      {activeTab === 'calibration' && (
        <form onSubmit={handleSaveDeviceNvs} className="space-y-5">
          <div className="p-4 rounded-xl bg-[#172338] border border-[#60a5fa]/25 text-xs text-[#bfdbfe] flex items-start gap-3">
            <Info className="w-4 h-4 text-[#60a5fa] shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Parameters here are written directly to your monitor&apos;s onboard NVS flash using the
              AirGradient Local Server configuration API.
            </p>
          </div>

          <MatCard className="p-4 sm:p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-white font-display">
                  CO₂ Automatic Baseline Calibration
                </h2>
                <p className="text-xs text-[#8f96a6] mt-0.5">
                  Senseair NDIR rolling baseline window
                </p>
              </div>
              <a
                href="https://github.com/airgradienthq/arduino/releases/tag/3.0.3"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#93c5fd] hover:underline flex items-center gap-1 shrink-0 w-fit"
              >
                <span>Firmware 3.0.3+</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            <div className="max-w-md">
              <MatSelect
                label="ABC Duration"
                value={config.abcDays}
                onChange={(v) => setConfig({ ...config, abcDays: parseInt(v, 10) })}
                options={[
                  { value: 8, label: '8 days (Factory Default)' },
                  { value: 14, label: '14 days' },
                  { value: 30, label: '30 days' },
                  { value: 0, label: 'Disabled (0 days)' },
                ]}
              />
            </div>

            <MatDivider />

            <div>
              <h2 className="text-sm font-semibold text-white font-display">
                VOC &amp; NOₓ Learning Time Offset
              </h2>
              <p className="text-xs text-[#8f96a6] mt-0.5">
                Sensirion SGP41 adaptation window for baseline indexing
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 max-w-xl">
              <MatSelect
                label="VOC Index Offset"
                value={config.tvocLearningOffset}
                onChange={(v) =>
                  setConfig({ ...config, tvocLearningOffset: parseInt(v, 10) })
                }
                options={[
                  { value: 12, label: '12 hours (Factory Default)' },
                  { value: 24, label: '24 hours' },
                  { value: 48, label: '48 hours' },
                  { value: 72, label: '72 hours' },
                  { value: 168, label: '168 hours (7 days)' },
                  { value: 720, label: '720 hours (30 days)' },
                ]}
              />

              <MatSelect
                label="NOₓ Index Offset"
                value={config.noxLearningOffset}
                onChange={(v) =>
                  setConfig({ ...config, noxLearningOffset: parseInt(v, 10) })
                }
                options={[
                  { value: 12, label: '12 hours (Factory Default)' },
                  { value: 24, label: '24 hours' },
                  { value: 48, label: '48 hours' },
                  { value: 72, label: '72 hours' },
                  { value: 168, label: '168 hours (7 days)' },
                  { value: 720, label: '720 hours (30 days)' },
                ]}
              />
            </div>

            <MatDivider />

            <div>
              <h2 className="text-sm font-semibold text-white font-display">
                Sensor Correction Algorithms &amp; Offsets
              </h2>
              <p className="text-xs text-[#8f96a6] mt-0.5">
                Applied onboard when computing compensated measurements.
              </p>
            </div>

            {/* PM2.5 Calibration */}
            <div className="rounded-xl bg-[#14171d] border border-white/[0.1] p-4 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                <div>
                  <h3 className="text-[13px] font-semibold text-white font-display">
                    PM2.5 Calibration
                  </h3>
                  <p className="text-xs text-[#8f96a6] mt-0.5">
                    PMS5003 batch linear correction factor with optional US EPA 2021 humidity compensation.
                  </p>
                </div>
                {pmAlgorithm !== 'custom' &&
                  pmAlgorithm !== 'none' &&
                  pmAlgorithm !== 'epa_2021' &&
                  typeof pmActiveScale === 'number' && (
                    <span className="text-[11px] font-mono tabular-nums text-[#93c5fd] bg-[#1e3a5f]/50 border border-[#60a5fa]/25 rounded-md px-2 py-0.5 w-fit shrink-0">
                      factor {pmActiveScale} · offset {pmActiveOffset}
                    </span>
                  )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                <MatSelect
                  label="Correction Preset"
                  value={pmAlgorithm}
                  onChange={handlePmPresetChange}
                  options={pmSelectOptions}
                  hint={
                    pmAlgorithm === 'none'
                      ? 'Uses raw uncompensated PMS5003 readings.'
                      : pmAlgorithm === 'custom'
                      ? 'Applies custom scaling factor and offset to PM0.3 particle count.'
                      : pmAlgorithm === 'epa_2021'
                      ? 'Applies US EPA 2021 humidity compensation to raw PM2.5.'
                      : !isExplicitPmOption
                      ? 'Monitor-reported algorithm preserved verbatim until changed.'
                      : 'Applies AirGradient batch linear regression calibration.'
                  }
                />

                <div className="md:pt-[22px]">
                  <MatCheckbox
                    checked={pmUseEpa2021}
                    onChange={handlePmUseEpaChange}
                    label="Apply EPA Formula"
                    description={
                      pmAlgorithm === 'none'
                        ? 'Inactive while PM2.5 correction is set to None.'
                        : pmAlgorithm === 'epa_2021'
                        ? 'Included automatically by EPA 2021 mode; switch to a batch preset or Custom to toggle independently.'
                        : 'Applies US EPA 2021 humidity compensation after scaling.'
                    }
                    className={
                      pmAlgorithm === 'none' || pmAlgorithm === 'epa_2021'
                        ? 'opacity-60'
                        : ''
                    }
                  />
                </div>
              </div>

              {pmAlgorithm === 'custom' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <MatTextField
                    type="number"
                    step="any"
                    mono
                    label="Scaling Factor"
                    value={pmScaleText}
                    onChange={handlePmScaleTextChange}
                    placeholder="0.022739"
                    hint={
                      pmScaleError ? (
                        <span className="text-rose-400">{pmScaleError}</span>
                      ) : (
                        'Valid range: > 0 to 10'
                      )
                    }
                  />
                  <MatTextField
                    type="number"
                    step="any"
                    mono
                    label="Offset (µg/m³)"
                    value={pmOffsetText}
                    onChange={handlePmOffsetTextChange}
                    placeholder="0"
                    hint={
                      pmOffsetError ? (
                        <span className="text-rose-400">{pmOffsetError}</span>
                      ) : (
                        'Valid range: -100 to 100 (default 0)'
                      )
                    }
                  />
                </div>
              )}

              <div className="pt-2.5 border-t border-white/[0.08] text-[11px] text-[#8f96a6] font-mono">
                <span title="Authoritative PM2.5 calibration state returned by GET /api/v1/config">
                  {formatPmReadbackLine(reportedPm02)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
              <div className="space-y-4">
                <MatSelect
                  label="Temperature Formula"
                  value={tempAlgo}
                  onChange={(v) =>
                    setConfig({
                      ...config,
                      corrections: {
                        ...config.corrections,
                        temp: {
                          ...config.corrections?.temp,
                          correctionAlgorithm: v,
                          slr: { intercept: tempIntercept, scalingFactor: 1.0 },
                        },
                      },
                    })
                  }
                  options={[
                    {
                      value: 'ag_pms5003t_default',
                      label: 'Standard AirGradient Compensation',
                    },
                    { value: 'slr', label: 'Custom Linear Intercept' },
                    { value: 'none', label: 'Raw Uncompensated' },
                  ]}
                />

                <MatTextField
                  type="number"
                  step="0.1"
                  min="-5.0"
                  max="5.0"
                  mono
                  label="Temperature Offset (°C)"
                  value={tempIntercept}
                  onChange={(v) =>
                    setConfig({
                      ...config,
                      corrections: {
                        ...config.corrections,
                        temp: {
                          correctionAlgorithm: tempAlgo,
                          slr: {
                            intercept: parseFloat(v) || 0,
                            scalingFactor: 1.0,
                          },
                        },
                      },
                    })
                  }
                />
              </div>

              <div className="space-y-4">
                <MatSelect
                  label="Humidity Formula"
                  value={rhumAlgo}
                  onChange={(v) =>
                    setConfig({
                      ...config,
                      corrections: {
                        ...config.corrections,
                        rhum: {
                          ...config.corrections?.rhum,
                          correctionAlgorithm: v,
                          slr: { intercept: rhumIntercept, scalingFactor: 1.0 },
                        },
                      },
                    })
                  }
                  options={[
                    {
                      value: 'ag_pms5003t_default',
                      label: 'Standard AirGradient Compensation',
                    },
                    { value: 'slr', label: 'Custom Linear Intercept' },
                    { value: 'none', label: 'Raw Uncompensated' },
                  ]}
                />

                <MatTextField
                  type="number"
                  step="0.5"
                  min="-15.0"
                  max="15.0"
                  mono
                  label="Humidity Offset (% RH)"
                  value={rhumIntercept}
                  onChange={(v) =>
                    setConfig({
                      ...config,
                      corrections: {
                        ...config.corrections,
                        rhum: {
                          correctionAlgorithm: rhumAlgo,
                          slr: {
                            intercept: parseFloat(v) || 0,
                            scalingFactor: 1.0,
                          },
                        },
                      },
                    })
                  }
                />
              </div>
            </div>

            <MatDivider />

            <div className="flex justify-end">
              <MatButton
                type="submit"
                variant="filled"
                disabled={savingDevice || Boolean(pmScaleError || pmOffsetError)}
                className="w-full sm:w-auto"
                icon={
                  savingDevice ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined
                }
              >
                Save Calibration to Monitor
              </MatButton>
            </div>
          </MatCard>

          {/* Manual 400 ppm CO2 Calibration (Single Confirmation Dialog Guard) */}
          <MatCard className="p-4 sm:p-6 space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <h2 className="text-sm font-semibold text-white font-display">
                Manual 400 ppm CO₂ Calibration
              </h2>
            </div>

            <MatDivider />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-[13px] font-medium text-[#e6e8ee]">
                  Immediate Senseair NDIR Baseline Reset
                </div>
                <p className="text-xs text-[#8f96a6] mt-0.5 max-w-lg leading-relaxed">
                  Places the CO₂ baseline at 400 ppm. Move the monitor outdoors in fresh ambient
                  air before running.
                </p>
              </div>

              <MatButton
                variant="warning"
                className="w-full sm:w-auto"
                onClick={() => setManualCalibModal(true)}
              >
                Trigger 400 ppm Reset
              </MatButton>
            </div>
          </MatCard>
        </form>
      )}

      {/* TAB 3: HARDWARE & FIRMWARE */}
      {activeTab === 'firmware' && (
        <div className="space-y-5">
          <MatCard className="p-4 sm:p-6 space-y-5">
            <div>
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-[#60a5fa] shrink-0" />
                <h2 className="text-sm font-semibold text-white font-display">
                  Auto-Detected Hardware &amp; Firmware
                </h2>
              </div>
              <p className="text-xs text-[#8f96a6] mt-0.5">
                Queried directly from your monitor&apos;s local telemetry endpoint.
              </p>
            </div>

            <MatDivider />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
              <div
                className="min-w-0 cursor-help"
                title="Hardware variant reported by /config or /measures/current"
              >
                <span className="text-xs text-[#8f96a6] block">Hardware Model</span>
                <span className="text-sm font-semibold text-white mt-1 block truncate">
                  {describeModel(config.model || detectedDevice?.model)}
                </span>
                <span className="text-xs text-[#9ca3af] font-mono mt-0.5 block">
                  ID: {config.model || detectedDevice?.model || '--'}
                </span>
              </div>

              <div
                className="min-w-0 cursor-help"
                title="Local HTTP API v1 requires AirGradient firmware v3.0.10+ for NVS PUT /config"
              >
                <span className="text-xs text-[#8f96a6] block">Installed Firmware</span>
                <span
                  className={`text-base font-bold font-mono mt-1 block ${
                    detectedDevice?.firmware ? 'text-emerald-400' : 'text-[#9ca3af]'
                  }`}
                >
                  {detectedDevice?.firmware ? `v${detectedDevice.firmware}` : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] mt-0.5 block">
                  {detectedDevice?.firmware ? 'Local API v1 Supported' : 'Awaiting monitor'}
                </span>
              </div>

              <div
                className="min-w-0 cursor-help"
                title="ESP32 MAC-derived serial ID and mDNS local hostname"
              >
                <span className="text-xs text-[#8f96a6] block">Device Serial</span>
                <span className="text-sm font-bold text-white font-mono mt-1 block truncate">
                  {detectedDevice?.serialno || '--'}
                </span>
                <span className="text-xs text-[#9ca3af] font-mono mt-0.5 block truncate">
                  {detectedDevice?.serialno
                    ? `airgradient_${detectedDevice.serialno}.local`
                    : 'Not detected'}
                </span>
              </div>

              {(() => {
                const hasDevice = Boolean(
                  detectedDevice?.serialno ||
                    detectedDevice?.firmware ||
                    (detectedDevice?.wifi_rssi !== undefined && detectedDevice.wifi_rssi !== 0)
                );
                const rssi = detectedDevice?.wifi_rssi ?? 0;
                const rssiQuality =
                  rssi >= -60
                    ? 'Excellent'
                    : rssi >= -70
                    ? 'Good'
                    : rssi >= -80
                    ? 'Fair'
                    : 'Weak';
                const bootCount = detectedDevice?.boot_count ?? telemetry?.raw.boot_count ?? 0;
                return (
                  <div
                    className="min-w-0 cursor-help"
                    title={
                      hasDevice
                        ? `WiFi RSSI ${rssi} dBm (${rssiQuality} signal) · ${bootCount} boots since flash`
                        : 'Awaiting monitor WiFi telemetry'
                    }
                  >
                    <span className="text-xs text-[#8f96a6] block">WiFi Signal</span>
                    <span className="text-base font-bold text-white font-mono tabular-nums mt-1 block">
                      {hasDevice ? (
                        <>
                          {rssi} dBm{' '}
                          <span className="text-xs font-sans font-normal text-[#9ca3af]">
                            ({rssiQuality})
                          </span>
                        </>
                      ) : (
                        '-- dBm'
                      )}
                    </span>
                    <span className="text-xs text-[#9ca3af] font-mono tabular-nums mt-0.5 block">
                      Boot count: {hasDevice ? bootCount : '--'}
                    </span>
                  </div>
                );
              })()}
            </div>

            <MatDivider />

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <span className="text-[13px] font-semibold text-white block">
                  Firmware Updates
                </span>
                <p className="text-xs text-[#8f96a6] max-w-xl leading-relaxed">
                  The AirGradient Local HTTP server does not accept firmware binary uploads over
                  LAN. Flash updates via USB-C using the AirGradient Web Flasher or enable Cloud
                  Sync temporarily.
                </p>
              </div>
              <div className="grid grid-cols-2 sm:flex items-center gap-2 shrink-0 w-full sm:w-auto">
                <a
                  href="https://www.airgradient.com/documentation/firmwares/"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium text-[#e6e8ee] border border-white/[0.2] hover:bg-white/[0.06] gap-1.5 whitespace-nowrap"
                >
                  <span>Web Flasher</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <a
                  href="https://github.com/airgradienthq/arduino/releases"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium text-[#e6e8ee] border border-white/[0.2] hover:bg-white/[0.06] gap-1.5 whitespace-nowrap"
                >
                  <span>Releases</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          </MatCard>

          <MatCard className="p-4 sm:p-6 space-y-3">
            <h2 className="text-sm font-semibold text-white font-display">
              Local Server API Compatibility
            </h2>
            <div className="divide-y divide-white/[0.08] text-xs">
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#cbd5e1] min-w-0">
                  Auto Hardware Model &amp; Serial Querying
                </span>
                <span className="font-mono text-emerald-400 shrink-0">v3.0.10+</span>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#cbd5e1] min-w-0">Local NVS Configuration Control</span>
                <span className="font-mono text-emerald-400 shrink-0">v3.0.10+</span>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#cbd5e1] min-w-0">
                  ABC Days &amp; SGP41 Learning Offset
                </span>
                <span className="font-mono text-emerald-400 shrink-0">v3.0.3+</span>
              </div>
              <div className="py-3 flex items-center justify-between gap-4">
                <span className="text-[#cbd5e1] min-w-0">
                  PM2.5 EPA 2021 &amp; Temp/RH Linear Corrections
                </span>
                <span className="font-mono text-emerald-400 shrink-0">v3.1.4+</span>
              </div>
            </div>
          </MatCard>
        </div>
      )}

      {/* TAB 4: CONNECTIVITY */}
      {activeTab === 'connectivity' && (
        <div className="space-y-5">
          {/* Card 1: PiGradient Collector Target LAN Address */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSavingTarget(true);
              setSaveStatus(null);
              try {
                await onUpdateTargetUrl(targetInput);
                setSaveStatus({
                  type: 'success',
                  message: `Target monitor address updated to ${targetInput}.`,
                });
              } catch (err: any) {
                setSaveStatus({
                  type: 'error',
                  message: err.message || 'Failed to update target monitor URL.',
                });
              } finally {
                setSavingTarget(false);
              }
            }}
          >
            <MatCard className="p-4 sm:p-6 space-y-5">
              <div>
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#60a5fa] shrink-0" />
                  <h2 className="text-sm font-semibold text-white font-display">
                    Target AirGradient Monitor
                  </h2>
                </div>
                <p className="text-xs text-[#8f96a6] mt-0.5">
                  Local LAN IP or mDNS address polled continuously at 1 Hz by the PiGradient gateway.
                </p>
              </div>

              <MatDivider />

              <MatTextField
                label="Device URL or IP Address"
                value={targetInput}
                onChange={setTargetInput}
                placeholder="http://192.168.1.150"
                mono
                required
                hint={
                  <>
                    Accepts static LAN IP or mDNS hostname such as{' '}
                    <code className="text-[#cbd5e1] font-mono">
                      http://airgradient_&lt;serial&gt;.local
                    </code>
                    .
                  </>
                }
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                <div
                  className="flex sm:flex-col justify-between gap-1 cursor-help"
                  title="Collector HTTP polling status against target AirGradient LAN monitor"
                >
                  <span className="text-[#8f96a6]">Collector Health</span>
                  <span
                    className={`font-mono font-semibold ${
                      systemStats && !systemStats.targetDeviceUrl
                        ? 'text-amber-400'
                        : systemStats?.collectorStatus === 'online'
                        ? 'text-emerald-400'
                        : systemStats?.collectorStatus === 'degraded'
                        ? 'text-amber-400'
                        : 'text-rose-400'
                    }`}
                  >
                    {systemStats && !systemStats.targetDeviceUrl
                      ? 'Not Configured'
                      : systemStats?.collectorStatus === 'degraded'
                      ? 'Degraded'
                      : systemStats?.collectorStatus === 'offline'
                      ? 'Offline'
                      : 'Online'}
                  </span>
                </div>
                <div
                  className="flex sm:flex-col justify-between gap-1 cursor-help"
                  title="Latest LAN HTTP roundtrip time for GET /measures/current"
                >
                  <span className="text-[#8f96a6]">Roundtrip Latency</span>
                  <span className="font-mono tabular-nums text-[#e6e8ee]">
                    {systemStats && systemStats.latencyMs > 0 ? `${systemStats.latencyMs} ms` : '--'}
                  </span>
                </div>
                <div
                  className="flex sm:flex-col justify-between gap-1 cursor-help"
                  title="Browser Server-Sent Events (SSE) push connection status"
                >
                  <span className="text-[#8f96a6]">SSE Stream Status</span>
                  <span
                    className={`font-mono font-medium ${
                      isStreamConnected ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {isStreamConnected ? 'Connected (1 Hz)' : 'Connecting...'}
                  </span>
                </div>
              </div>

              <MatDivider />

              <div className="flex justify-end">
                <MatButton
                  type="submit"
                  variant="filled"
                  disabled={savingTarget}
                  className="w-full sm:w-auto"
                  icon={
                    savingTarget ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined
                  }
                >
                  Save &amp; Connect
                </MatButton>
              </div>
            </MatCard>
          </form>

          {/* Card 2: Monitor NVS Network / MQTT / Cloud Settings */}
          <form onSubmit={handleSaveDeviceNvs}>
            <MatCard className="p-4 sm:p-6 space-y-5">
            <div>
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-[#60a5fa] shrink-0" />
                <h2 className="text-sm font-semibold text-white font-display">
                  Network, MQTT &amp; Cloud Sync
                </h2>
              </div>
              <p className="text-xs text-[#8f96a6] mt-0.5">
                Stored directly on your monitor&apos;s NVS flash.
              </p>
            </div>

            <MatDivider />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
              <div className="md:col-span-2">
                <MatTextField
                  label="Local MQTT Broker URL"
                  value={config.mqttBrokerUrl}
                  onChange={(v) => setConfig({ ...config, mqttBrokerUrl: v })}
                  placeholder="mqtt://192.168.1.50:1883"
                  mono
                  hint="Optional: Publishes directly from your monitor to a Home Assistant or Mosquitto broker. Leave blank to disable."
                />
              </div>

              <MatTextField
                label="Country Code"
                maxLength={2}
                value={config.country}
                onChange={(v) => setConfig({ ...config, country: v.toUpperCase() })}
                placeholder="US"
                mono
                className="sm:max-w-[160px]"
              />

              <MatSelect
                label="Configuration Control"
                value={config.configurationControl}
                onChange={(v) =>
                  setConfig({ ...config, configurationControl: v as any })
                }
                options={[
                  { value: 'local', label: 'Local (PiGradient authoritative)' },
                  { value: 'both', label: 'Both (Local + Cloud hybrid)' },
                  { value: 'cloud', label: 'Cloud (AirGradient Dashboard)' },
                ]}
              />
            </div>

            <MatDivider />

            <div className="space-y-1">
              <MatSwitch
                checked={config.postDataToAirGradient}
                onChange={(checked) =>
                  setConfig({ ...config, postDataToAirGradient: checked })
                }
                label="Post Data to AirGradient Cloud"
                description="Sends periodic telemetry uploads to app.airgradient.com."
              />

              <MatDivider />

              <MatSwitch
                checked={config.offlineMode}
                onChange={(checked) =>
                  setConfig({
                    ...config,
                    offlineMode: checked,
                    disableCloudConnection: checked,
                  })
                }
                label="Air-Gapped Offline Mode"
                description="Disables cloud synchronization so the monitor operates strictly on your local LAN."
              />
            </div>

            <MatDivider />

            <div className="flex justify-end">
              <MatButton
                type="submit"
                variant="filled"
                disabled={savingDevice}
                className="w-full sm:w-auto"
                icon={
                  savingDevice ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined
                }
              >
                Save Connectivity to Monitor
              </MatButton>
            </div>
          </MatCard>
          </form>
        </div>
      )}

      {/* Material Dialog: Manual CO2 400 ppm Calibration (Single Guard) */}
      <MatDialog
        open={manualCalibModal}
        onClose={() => {
          setManualCalibModal(false);
          setOutdoorConfirmed(false);
        }}
        maxWidthClass="max-w-lg"
        title="Manual CO₂ Calibration"
        subtitle="Resets Senseair NDIR baseline to 400 ppm"
        icon={
          <div className="w-10 h-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-amber-400" />
          </div>
        }
        actions={
          <>
            <MatButton
              variant="text"
              onClick={() => {
                setManualCalibModal(false);
                setOutdoorConfirmed(false);
              }}
            >
              Cancel
            </MatButton>
            <MatButton
              variant="warning"
              disabled={!outdoorConfirmed || savingDevice}
              onClick={executeManual400PpmReset}
              icon={
                savingDevice ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : undefined
              }
            >
              Confirm 400 ppm Reset
            </MatButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-200/90 leading-relaxed space-y-2">
            <p>
              <strong>Warning:</strong> Executing a manual baseline sets the CO₂ sensor reading
              to <strong>400 ppm</strong> immediately.
            </p>
            <p>
              If executed indoors where CO₂ is elevated (600–1200+ ppm), the sensor will
              underreport true CO₂ levels until recalibrated outdoors.
            </p>
          </div>

          <MatCheckbox
            accent="amber"
            checked={outdoorConfirmed}
            onChange={setOutdoorConfirmed}
            label={
              <>
                I confirm the monitor has been placed outdoors in clean, fresh ambient air for at
                least <strong>15–20 minutes</strong>.
              </>
            }
          />
        </div>
      </MatDialog>

      {/* Material Dialog: LED Modes Reference */}
      <MatDialog
        open={showLedInfoModal}
        onClose={() => setShowLedInfoModal(false)}
        title="Local API LED Bar Modes"
        icon={<Info className="w-5 h-5 text-[#60a5fa]" />}
        actions={
          <MatButton variant="filled" onClick={() => setShowLedInfoModal(false)}>
            Close
          </MatButton>
        }
      >
        <div className="divide-y divide-white/[0.08] text-xs">
          <div className="py-3 first:pt-0 space-y-1">
            <span className="font-semibold text-emerald-400 block font-mono">pm</span>
            <p className="text-[#9ca3af] leading-relaxed">
              Visualizes PM2.5 air quality levels across the 9 front LEDs using the standard
              AirGradient particulate color scale.
            </p>
          </div>

          <div className="py-3 space-y-1">
            <span className="font-semibold text-sky-400 block font-mono">co2</span>
            <p className="text-[#9ca3af] leading-relaxed">
              Colors based strictly on indoor carbon dioxide concentration: Green (&lt;800 ppm),
              Yellow (800–1000 ppm), Orange (1000–1400 ppm), Red (&gt;1400 ppm).
            </p>
          </div>

          <div className="py-3 last:pb-0 space-y-1">
            <span className="font-semibold text-[#cbd5e1] block font-mono">off</span>
            <p className="text-[#9ca3af] leading-relaxed">
              Turns off the 9-LED bar completely while keeping OLED and telemetry active.
            </p>
          </div>
        </div>
      </MatDialog>
    </div>
  );
};
