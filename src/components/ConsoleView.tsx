import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
  Plugin,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import {
  Play,
  Pause,
  RotateCcw,
  RefreshCw,
  SlidersHorizontal,
  Download,
  Database,
  HelpCircle,
  WifiOff,
} from 'lucide-react';
import { LiveTelemetryPayload, HistoricalPoint } from '../types/telemetry';
import {
  MatButton,
  MatCard,
  MatCheckbox,
  MatDivider,
  MatSegmentedButton,
} from './material/MaterialUI';
import {
  calculateAbsoluteHumidity,
  calculateDewPointC,
  calculateHeatIndexC,
  calculatePm25Aqi,
  computeRollingAverage,
  computeSeriesStats,
  cToF,
  SeriesStatsSummary,
} from '../utils/environment';
import { useAccessibility } from '../contexts/AccessibilityContext';
import { SignalReferenceDialog } from './SignalReferenceDialog';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface ConsoleViewProps {
  telemetry: LiveTelemetryPayload | null;
  telemetryStale?: boolean;
  staleSeconds?: number;
  tempUnit: 'f' | 'c';
  setTempUnit: (unit: 'f' | 'c') => void;
  onOpenConnectivity?: () => void;
}

type TimeRangePreset = '5m' | '15m' | '1h' | '6h' | '24h' | '7d' | '30d';

type MovingAvgWindow = 0 | 5 | 15 | 30;

interface AxisSelection {
  showCo2: boolean;
  showPm1: boolean;
  showPm25: boolean;
  showPm10: boolean;
  showTemp: boolean;
  showHum: boolean;
  showTvoc: boolean;
  showNox: boolean;
  // Generated / processed environmental series
  showAqi: boolean;
  showDewPoint: boolean;
  showHeatIndex: boolean;
  showAbsHumidity: boolean;
}

interface AnalyticsToolsConfig {
  movingAvgWindow: MovingAvgWindow;
  rollingAvgOnly: boolean;
  showGuidelines: boolean;
  showLimits: boolean;
}

const DEFAULT_AXES: AxisSelection = {
  showCo2: true,
  showPm1: false,
  showPm25: true,
  showPm10: false,
  showTemp: false,
  showHum: false,
  showTvoc: false,
  showNox: false,
  showAqi: false,
  showDewPoint: false,
  showHeatIndex: false,
  showAbsHumidity: false,
};

const DEFAULT_ANALYTICS_TOOLS: AnalyticsToolsConfig = {
  movingAvgWindow: 0,
  rollingAvgOnly: false,
  showGuidelines: true,
  showLimits: true,
};

const RANGE_WINDOW_SEC: Record<TimeRangePreset, number> = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
};

const RANGE_INTERVAL_SEC: Record<TimeRangePreset, number> = {
  '5m': 1,
  '15m': 3,
  '1h': 10,
  '6h': 60,
  '24h': 300,
  '7d': 1800,
  '30d': 7200,
};

const LIVE_CADENCE_SEC: Record<TimeRangePreset, number> = {
  '5m': 1,
  '15m': 3,
  '1h': 10,
  '6h': 20,
  '24h': 30,
  '7d': 60,
  '30d': 60,
};

function formatWindowDuration(points: number, intervalSec: number): string {
  const sec = points * intervalSec;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Number((sec / 60).toFixed(1))}m`;
  return `${Number((sec / 3600).toFixed(1))}h`;
}

const MOVING_AVG_WINDOWS: MovingAvgWindow[] = [5, 15, 30];

const TIME_PRESETS: { id: TimeRangePreset; label: string; title?: string }[] = [
  { id: '5m', label: '5m Live', title: '5-minute window (1s live updates)' },
  { id: '15m', label: '15m', title: '15-minute window (3s buckets, live updates every 3s)' },
  { id: '1h', label: '1h', title: '1-hour window (10s buckets, live updates every 10s)' },
  { id: '6h', label: '6h', title: '6-hour window (1m buckets, live updates when perceptible)' },
  { id: '24h', label: '24h', title: '24-hour window (5m buckets, live updates when perceptible)' },
  { id: '7d', label: '7d', title: '7-day window (30m buckets, live updates when perceptible)' },
  { id: '30d', label: '30d', title: '30-day archive (2h buckets, live updates when perceptible)' },
];

const ANALYTICS_STORAGE_KEY = 'pigradient_analytics_tools_v3';

// SSE gap threshold: a frame landing >2s after the buffered tail means the 5m
// live buffer has a hole that CategoryScale would squish — backfill from archive
const SSE_GAP_BACKFILL_SEC = 2;

// 5m live buffer capacity (300 × 1s frames)
const LIVE_BUFFER_MAX_POINTS = 300;

export const ConsoleView: React.FC<ConsoleViewProps> = ({
  telemetry,
  telemetryStale = false,
  staleSeconds = 0,
  tempUnit,
  setTempUnit,
  onOpenConnectivity,
}) => {
  const { prefs } = useAccessibility();
  const [rangePreset, setRangePreset] = useState<TimeRangePreset>('5m');
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [historyData, setHistoryData] = useState<HistoricalPoint[]>([]);
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState<boolean>(false);
  const [showReferenceModal, setShowReferenceModal] = useState<boolean>(false);

  const [axes, setAxes] = useState<AxisSelection>(() => {
    try {
      const saved = localStorage.getItem('pigradient_axes_config');
      if (saved) return { ...DEFAULT_AXES, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_AXES;
  });

  const [analyticsTools, setAnalyticsTools] = useState<AnalyticsToolsConfig>(() => {
    try {
      const saved = localStorage.getItem(ANALYTICS_STORAGE_KEY);
      if (saved) return { ...DEFAULT_ANALYTICS_TOOLS, ...JSON.parse(saved) };
    } catch {}
    return DEFAULT_ANALYTICS_TOOLS;
  });

  useEffect(() => {
    localStorage.setItem('pigradient_axes_config', JSON.stringify(axes));
  }, [axes]);

  useEffect(() => {
    localStorage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(analyticsTools));
  }, [analyticsTools]);

  const [liveBuffer, setLiveBuffer] = useState<HistoricalPoint[]>([]);
  const [isExportingRaw, setIsExportingRaw] = useState<boolean>(false);
  const fetchSeqRef = useRef<number>(0);
  const liveTailTsRef = useRef<number>(0);
  const backfillInFlightRef = useRef<Set<string>>(new Set());
  const backfillDoneRef = useRef<Set<string>>(new Set());
  const liveBucketRef = useRef<{
    preset: TimeRangePreset;
    bucketTs: number;
    count: number;
    sumPm01: number;
    sumPm02: number;
    sumPm10: number;
    sumCo2: number;
    sumAtmp: number;
    sumRhum: number;
    sumTvoc: number;
    sumNox: number;
  } | null>(null);
  const lastNon5mFlushRef = useRef<number>(0);

  const fetchHistoricalData = async (preset: TimeRangePreset) => {
    const seq = ++fetchSeqRef.current;
    setIsLoadingHistory(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const windowSec = RANGE_WINDOW_SEC[preset];
      const intervalSec = RANGE_INTERVAL_SEC[preset];

      const start = now - windowSec;
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/v1/history?start=${start}&end=${now}&interval=${intervalSec}`
      );
      if (res.ok && seq === fetchSeqRef.current) {
        const points: HistoricalPoint[] = await res.json();
        if (preset === '5m') {
          setLiveBuffer(points.slice(-300));
        } else {
          const curBucketTs = Math.floor(now / intervalSec) * intervalSec;
          const tail = points[points.length - 1];
          if (tail && tail.timestamp === curBucketTs) {
            const weight = Math.max(1, Math.min(intervalSec, now - curBucketTs));
            liveBucketRef.current = {
              preset,
              bucketTs: curBucketTs,
              count: weight,
              sumPm01: (tail.pm01 ?? 0) * weight,
              sumPm02: tail.pm02_comp * weight,
              sumPm10: (tail.pm10 ?? 0) * weight,
              sumCo2: tail.rco2 * weight,
              sumAtmp: tail.atmp_comp * weight,
              sumRhum: tail.rhum_comp * weight,
              sumTvoc: tail.tvoc_index * weight,
              sumNox: tail.nox_index * weight,
            };
          } else {
            liveBucketRef.current = null;
          }
          lastNon5mFlushRef.current = now;
          setHistoryData(points);
        }
      }
    } catch {
      // Transient history load failure handled cleanly with existing buffer
    } finally {
      if (seq === fetchSeqRef.current) {
        setIsLoadingHistory(false);
      }
    }
  };

  useEffect(() => {
    fetchHistoricalData(rangePreset);
  }, [rangePreset]);

  // Track the newest buffered timestamp for SSE gap detection (kept in sync with
  // every liveBuffer write: history load, live append, and archive backfill)
  useEffect(() => {
    liveTailTsRef.current =
      liveBuffer.length > 0 ? liveBuffer[liveBuffer.length - 1].timestamp : 0;
  }, [liveBuffer]);

  // Backfill an SSE gap (frame landed >2s after the buffered tail) from the 1s
  // archive so the 5m chart doesn't squish the hole via CategoryScale. Skips
  // ranges that are in flight or already backfilled.
  const backfillSseGap = async (fromTs: number, toTs: number) => {
    const start = Math.max(fromTs + 1, toTs - LIVE_BUFFER_MAX_POINTS);
    const end = toTs - 1;
    if (end < start) return;
    const rangeKey = `${start}-${end}`;
    if (backfillInFlightRef.current.has(rangeKey) || backfillDoneRef.current.has(rangeKey)) {
      return;
    }
    backfillInFlightRef.current.add(rangeKey);
    try {
      const res = await fetch(
        `${import.meta.env.BASE_URL}api/v1/history?start=${start}&end=${end}&interval=1`
      );
      if (!res.ok) return;
      const points: HistoricalPoint[] = await res.json();
      backfillDoneRef.current.add(rangeKey);
      setLiveBuffer((prev) => {
        if (prev.length === 0 || !Array.isArray(points) || points.length === 0) return prev;
        const existingTs = new Set(prev.map((p) => p.timestamp));
        const fresh = points.filter(
          (p) => p && p.timestamp >= start && p.timestamp <= end && !existingTs.has(p.timestamp)
        );
        if (fresh.length === 0) return prev;
        // Archive points are older than the current live tail — merge in
        // timestamp order and re-cap to the 5m window
        const merged = [...prev, ...fresh].sort((a, b) => a.timestamp - b.timestamp);
        return merged.length > LIVE_BUFFER_MAX_POINTS
          ? merged.slice(-LIVE_BUFFER_MAX_POINTS)
          : merged;
      });
    } catch {
      // Transient backfill failure — the gap remains until another gap triggers a retry
    } finally {
      backfillInFlightRef.current.delete(rangeKey);
    }
  };

  useEffect(() => {
    if (!telemetry || telemetry.timestamp <= 0 || !isLiveStreaming || isLoadingHistory) return;

    if (rangePreset === '5m') {
      // SSE gap detection: a frame landing >2s after the buffered tail means the
      // live buffer has a hole — fetch the missing archive slice in the background
      const lastTs = liveTailTsRef.current;
      if (lastTs > 0 && telemetry.timestamp - lastTs > SSE_GAP_BACKFILL_SEC) {
        void backfillSseGap(lastTs, telemetry.timestamp);
      }
      setLiveBuffer((prev) => {
        const last = prev[prev.length - 1];
        // >= (not ===): drop stale/cached frames that are older than the tail —
        // e.g. telemetry that arrives after switching back to the 5m preset
        if (last && last.timestamp >= telemetry.timestamp) return prev;
        const newPoint: HistoricalPoint = {
          timestamp: telemetry.timestamp,
          pm01: telemetry.raw.pm01,
          pm02_comp: telemetry.raw.pm02_comp,
          pm10: telemetry.raw.pm10,
          rco2: telemetry.raw.rco2,
          atmp_comp: telemetry.raw.atmp_comp,
          rhum_comp: telemetry.raw.rhum_comp,
          tvoc_index: telemetry.raw.tvoc_index,
          nox_index: telemetry.raw.nox_index,
        };
        const next = [...prev, newPoint];
        if (next.length > 300) next.shift();
        return next;
      });
      return;
    }

    const intervalSec = RANGE_INTERVAL_SEC[rangePreset];
    const windowSec = RANGE_WINDOW_SEC[rangePreset];
    const cadenceSec = LIVE_CADENCE_SEC[rangePreset];
    const bucketTs = Math.floor(telemetry.timestamp / intervalSec) * intervalSec;

    const acc = liveBucketRef.current;
    if (!acc || acc.preset !== rangePreset || acc.bucketTs !== bucketTs) {
      liveBucketRef.current = {
        preset: rangePreset,
        bucketTs,
        count: 1,
        sumPm01: telemetry.raw.pm01,
        sumPm02: telemetry.raw.pm02_comp,
        sumPm10: telemetry.raw.pm10,
        sumCo2: telemetry.raw.rco2,
        sumAtmp: telemetry.raw.atmp_comp,
        sumRhum: telemetry.raw.rhum_comp,
        sumTvoc: telemetry.raw.tvoc_index,
        sumNox: telemetry.raw.nox_index,
      };
    } else {
      acc.count += 1;
      acc.sumPm01 += telemetry.raw.pm01;
      acc.sumPm02 += telemetry.raw.pm02_comp;
      acc.sumPm10 += telemetry.raw.pm10;
      acc.sumCo2 += telemetry.raw.rco2;
      acc.sumAtmp += telemetry.raw.atmp_comp;
      acc.sumRhum += telemetry.raw.rhum_comp;
      acc.sumTvoc += telemetry.raw.tvoc_index;
      acc.sumNox += telemetry.raw.nox_index;
    }

    const cur = liveBucketRef.current!;
    const nextPoint: HistoricalPoint = {
      timestamp: cur.bucketTs,
      pm01: Math.round((cur.sumPm01 / cur.count) * 10) / 10,
      pm02_comp: Math.round((cur.sumPm02 / cur.count) * 10) / 10,
      pm10: Math.round((cur.sumPm10 / cur.count) * 10) / 10,
      rco2: Math.round(cur.sumCo2 / cur.count),
      atmp_comp: Math.round((cur.sumAtmp / cur.count) * 10) / 10,
      rhum_comp: Math.round((cur.sumRhum / cur.count) * 10) / 10,
      tvoc_index: Math.round(cur.sumTvoc / cur.count),
      nox_index: Math.round(cur.sumNox / cur.count),
    };

    const nowSec = Math.floor(Date.now() / 1000);
    setHistoryData((prev) => {
      const cutoff = bucketTs - windowSec;
      const last = prev[prev.length - 1];

      if (!last || bucketTs > last.timestamp) {
        lastNon5mFlushRef.current = nowSec;
        const trimmed = prev.filter((p) => p.timestamp >= cutoff);
        return [...trimmed, nextPoint];
      }

      if (bucketTs === last.timestamp) {
        if (nowSec - lastNon5mFlushRef.current < cadenceSec) return prev;
        const perceptible =
          Math.abs((nextPoint.pm01 ?? 0) - (last.pm01 ?? 0)) >= 0.2 ||
          Math.abs(nextPoint.pm02_comp - last.pm02_comp) >= 0.2 ||
          Math.abs((nextPoint.pm10 ?? 0) - (last.pm10 ?? 0)) >= 0.2 ||
          Math.abs(nextPoint.rco2 - last.rco2) >= 2 ||
          Math.abs(nextPoint.atmp_comp - last.atmp_comp) >= 0.1 ||
          Math.abs(nextPoint.rhum_comp - last.rhum_comp) >= 0.3 ||
          Math.abs(nextPoint.tvoc_index - last.tvoc_index) >= 2 ||
          Math.abs(nextPoint.nox_index - last.nox_index) >= 1;
        if (!perceptible) return prev;
        lastNon5mFlushRef.current = nowSec;
        return [...prev.slice(0, -1), nextPoint];
      }

      return prev;
    });
  }, [telemetry, isLiveStreaming, rangePreset]);

  const activeData = rangePreset === '5m' ? liveBuffer : historyData;

  const { chartData, summaryRows } = useMemo(() => {
    const labels = activeData.map((d) => {
      const date = new Date(d.timestamp * 1000);
      if (rangePreset === '5m' || rangePreset === '15m') {
        return date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      }
      if (rangePreset === '1h' || rangePreset === '6h' || rangePreset === '24h') {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
    });

    const datasets: any[] = [];
    const summaries: {
      id: string;
      label: string;
      unit: string;
      colorClass: string;
      stats: SeriesStatsSummary;
    }[] = [];

    const maWin = analyticsTools.movingAvgWindow;
    const intervalSec = RANGE_INTERVAL_SEC[rangePreset];
    const maDurLabel = maWin > 0 ? formatWindowDuration(maWin, intervalSec) : '';
    const rollingOnly = analyticsTools.rollingAvgOnly && maWin > 1;
    const basePtRadius = prefs.colorblindSafe ? 2.5 : rangePreset === '5m' ? 0 : 1;

    const addSeries = (opts: {
      id: string;
      label: string;
      shortLabel: string;
      unit: string;
      color: string;
      darkColor: string;
      colorClass: string;
      yAxisID: string;
      values: number[];
      fillColor?: string;
      borderWidth?: number;
      borderDash?: number[];
      cbDash?: number[];
      cbPointStyle?: string;
    }) => {
      const canComputeMa = maWin > 1 && opts.values.length > 2;
      const maValues = canComputeMa ? computeRollingAverage(opts.values, maWin) : opts.values;
      const pointStyle = prefs.colorblindSafe ? (opts.cbPointStyle || 'circle') : 'circle';
      const activeDash = prefs.colorblindSafe ? opts.cbDash : opts.borderDash;

      if (rollingOnly && canComputeMa) {
        datasets.push({
          label: `${opts.shortLabel} (${maDurLabel} Avg)`,
          shortCanvasLabel: `${opts.shortLabel} Avg`,
          data: maValues,
          borderColor: opts.color,
          backgroundColor: opts.fillColor || 'transparent',
          fill: Boolean(opts.fillColor),
          yAxisID: opts.yAxisID,
          tension: 0.3,
          pointRadius: prefs.colorblindSafe ? 2 : 0,
          pointHoverRadius: 4,
          pointStyle,
          borderWidth: opts.borderWidth ?? 2,
          borderDash: activeDash,
          isMovingAverage: true,
        });
      } else {
        datasets.push({
          label: opts.label,
          data: opts.values,
          borderColor: opts.color,
          backgroundColor: opts.fillColor || 'transparent',
          fill: Boolean(opts.fillColor),
          yAxisID: opts.yAxisID,
          tension: 0.2,
          pointRadius: basePtRadius,
          pointHoverRadius: 4,
          pointStyle,
          borderWidth: opts.borderWidth ?? 1.8,
          borderDash: activeDash,
        });

        if (canComputeMa) {
          datasets.push({
            label: `${opts.shortLabel} (${maDurLabel} Avg)`,
            shortCanvasLabel: `${opts.shortLabel} Avg`,
            data: maValues,
            borderColor: opts.darkColor,
            fill: false,
            yAxisID: opts.yAxisID,
            tension: 0.3,
            pointRadius: 0,
            pointStyle,
            borderWidth: 2,
            borderDash: [5, 4],
            hideFromLegend: true,
            isMovingAverage: true,
          });
        }
      }

      const stats = computeSeriesStats(rollingOnly && canComputeMa ? maValues : opts.values);
      if (stats) {
        summaries.push({
          id: opts.id,
          label: opts.shortLabel,
          unit: opts.unit,
          colorClass: opts.colorClass,
          stats,
        });
      }
    };

    if (axes.showCo2) {
      addSeries({
        id: 'co2',
        label: 'CO₂ (ppm)',
        shortLabel: 'CO₂',
        unit: 'ppm',
        color: '#3B82F6',
        darkColor: '#1D4ED8',
        colorClass: 'text-[#60a5fa]',
        fillColor: 'rgba(59, 130, 246, 0.08)',
        yAxisID: 'y',
        values: activeData.map((d) => d.rco2),
        borderWidth: 2,
        cbPointStyle: 'circle',
      });
    }

    if (axes.showPm1) {
      addSeries({
        id: 'pm1',
        label: 'PM1.0 (µg/m³)',
        shortLabel: 'PM1.0',
        unit: 'µg/m³',
        color: '#A3E635',
        darkColor: '#4D7C0F',
        colorClass: 'text-lime-400',
        yAxisID: 'y1',
        values: activeData.map((d) => d.pm01 ?? 0),
        borderDash: [3, 2],
        cbDash: [3, 2],
        cbPointStyle: 'circle',
      });
    }

    if (axes.showPm25) {
      addSeries({
        id: 'pm25',
        label: 'PM2.5 (µg/m³)',
        shortLabel: 'PM2.5',
        unit: 'µg/m³',
        color: '#10B981',
        darkColor: '#047857',
        colorClass: 'text-emerald-400',
        fillColor: 'rgba(16, 185, 129, 0.05)',
        yAxisID: 'y1',
        values: activeData.map((d) => d.pm02_comp),
        borderWidth: 2,
        cbDash: [8, 3],
        cbPointStyle: 'triangle',
      });
    }

    if (axes.showPm10) {
      addSeries({
        id: 'pm10',
        label: 'PM10 (µg/m³)',
        shortLabel: 'PM10',
        unit: 'µg/m³',
        color: '#818CF8',
        darkColor: '#4338CA',
        colorClass: 'text-indigo-400',
        yAxisID: 'y1',
        values: activeData.map((d) => d.pm10 ?? 0),
        borderDash: [6, 3],
        cbDash: [6, 3],
        cbPointStyle: 'rectRot',
      });
    }

    if (axes.showTemp) {
      addSeries({
        id: 'temp',
        label: `Temp (°${tempUnit.toUpperCase()})`,
        shortLabel: 'Temp',
        unit: `°${tempUnit.toUpperCase()}`,
        color: '#F59E0B',
        darkColor: '#B45309',
        colorClass: 'text-amber-400',
        yAxisID: 'yTemp',
        values: activeData.map((d) => (tempUnit === 'f' ? cToF(d.atmp_comp) : d.atmp_comp)),
        cbDash: [4, 3],
        cbPointStyle: 'rect',
      });
    }

    if (axes.showHum) {
      addSeries({
        id: 'hum',
        label: 'Humidity (% RH)',
        shortLabel: 'Humidity',
        unit: '%',
        color: '#06B6D4',
        darkColor: '#0E7490',
        colorClass: 'text-cyan-400',
        yAxisID: 'yHum',
        values: activeData.map((d) => d.rhum_comp),
        cbDash: [2, 2],
        cbPointStyle: 'rectRot',
      });
    }

    if (axes.showTvoc) {
      addSeries({
        id: 'tvoc',
        label: 'TVOC Index',
        shortLabel: 'TVOC',
        unit: 'idx',
        color: '#8B5CF6',
        darkColor: '#6D28D9',
        colorClass: 'text-purple-400',
        yAxisID: 'yTvoc',
        values: activeData.map((d) => d.tvoc_index),
        cbDash: [10, 4, 2, 4],
        cbPointStyle: 'star',
      });
    }

    if (axes.showNox) {
      addSeries({
        id: 'nox',
        label: 'NOx Index',
        shortLabel: 'NOx',
        unit: 'idx',
        color: '#EC4899',
        darkColor: '#BE185D',
        colorClass: 'text-pink-400',
        yAxisID: 'yNox',
        values: activeData.map((d) => d.nox_index),
        cbDash: [6, 2, 2, 2],
        cbPointStyle: 'crossRot',
      });
    }

    // Generated / Processed Series (all support rolling averages too)
    if (axes.showAqi) {
      addSeries({
        id: 'aqi',
        label: 'EPA AQI',
        shortLabel: 'AQI',
        unit: 'AQI',
        color: '#F97316',
        darkColor: '#C2410C',
        colorClass: 'text-orange-400',
        yAxisID: 'yAqi',
        values: activeData.map((d) => calculatePm25Aqi(d.pm02_comp)),
        borderWidth: 2,
        cbDash: [12, 4],
        cbPointStyle: 'rectRounded',
      });
    }

    if (axes.showDewPoint) {
      addSeries({
        id: 'dew',
        label: `Dew Point (°${tempUnit.toUpperCase()})`,
        shortLabel: 'Dew Pt',
        unit: `°${tempUnit.toUpperCase()}`,
        color: '#38BDF8',
        darkColor: '#0369A1',
        colorClass: 'text-sky-400',
        yAxisID: 'yTemp',
        values: activeData.map((d) => {
          const dpC = calculateDewPointC(d.atmp_comp, d.rhum_comp);
          return tempUnit === 'f' ? cToF(dpC) : dpC;
        }),
        borderDash: [3, 3],
        cbDash: [3, 3],
        cbPointStyle: 'cross',
      });
    }

    if (axes.showHeatIndex) {
      addSeries({
        id: 'heat',
        label: `Heat Index (°${tempUnit.toUpperCase()})`,
        shortLabel: 'Heat Idx',
        unit: `°${tempUnit.toUpperCase()}`,
        color: '#FB7185',
        darkColor: '#BE123C',
        colorClass: 'text-rose-400',
        yAxisID: 'yTemp',
        values: activeData.map((d) => {
          const hiC = calculateHeatIndexC(d.atmp_comp, d.rhum_comp);
          return tempUnit === 'f' ? cToF(hiC) : hiC;
        }),
        borderDash: [6, 3],
        cbDash: [6, 3],
        cbPointStyle: 'dash',
      });
    }

    if (axes.showAbsHumidity) {
      addSeries({
        id: 'absHum',
        label: 'Abs. Humidity (g/m³)',
        shortLabel: 'Abs Hum',
        unit: 'g/m³',
        color: '#14B8A6',
        darkColor: '#0F766E',
        colorClass: 'text-teal-400',
        yAxisID: 'yAbsHum',
        values: activeData.map((d) => calculateAbsoluteHumidity(d.atmp_comp, d.rhum_comp)),
        cbDash: [14, 3, 3, 3],
        cbPointStyle: 'line',
      });
    }

    return { chartData: { labels, datasets }, summaryRows: summaries };
  }, [activeData, rangePreset, axes, tempUnit, analyticsTools, prefs.colorblindSafe]);

  // Ref for non-forcing canvas guideline/limit & moving-average label plugin
  const overlayStateRef = useRef({
    showGuidelines: analyticsTools.showGuidelines,
    showLimits: analyticsTools.showLimits,
    axes,
    tempUnit,
  });
  overlayStateRef.current = {
    showGuidelines: analyticsTools.showGuidelines,
    showLimits: analyticsTools.showLimits,
    axes,
    tempUnit,
  };

  const canvasOverlayPlugin = useMemo<Plugin<'line'>>(
    () => ({
      id: 'pigradientCanvasOverlays',
      afterDatasetsDraw(chart) {
        const { ctx, chartArea, scales, data } = chart;
        if (!chartArea || chartArea.width <= 0 || chartArea.height <= 0) return;

        const {
          showGuidelines,
          showLimits,
          axes: curAxes,
          tempUnit: curUnit,
        } = overlayStateRef.current;

        interface OverlayTag {
          targetY: number;
          text: string;
          color: string;
          textColor: string;
          side: 'left' | 'right';
          anchorX?: number;
        }

        interface ThresholdDef {
          kind: 'guideline' | 'limit';
          active: boolean;
          axisId: string;
          value: number;
          label: string;
          lineColor: string;
          textColor: string;
        }

        const tags: OverlayTag[] = [];

        const allThresholds: ThresholdDef[] = [
          // Ideal / Good Guidelines (dotted)
          {
            kind: 'guideline',
            active: showGuidelines && curAxes.showCo2,
            axisId: 'y',
            value: 800,
            label: 'CO₂ Good · 800 ppm',
            lineColor: '#2563EB',
            textColor: '#93C5FD',
          },
          {
            kind: 'guideline',
            active: showGuidelines && curAxes.showPm25,
            axisId: 'y1',
            value: 12.0,
            label: 'PM2.5 Good · 12 µg/m³',
            lineColor: '#059669',
            textColor: '#6EE7B7',
          },
          {
            kind: 'guideline',
            active: showGuidelines && curAxes.showAqi,
            axisId: 'yAqi',
            value: 50,
            label: 'EPA Good · 50 AQI',
            lineColor: '#EA580C',
            textColor: '#FDBA74',
          },
          {
            kind: 'guideline',
            active: showGuidelines && curAxes.showHum,
            axisId: 'yHum',
            value: 30,
            label: 'RH Min · 30%',
            lineColor: '#0891B2',
            textColor: '#67E8F9',
          },
          {
            kind: 'guideline',
            active: showGuidelines && curAxes.showTemp,
            axisId: 'yTemp',
            value: curUnit === 'f' ? 76 : 24.4,
            label: curUnit === 'f' ? 'ASHRAE Max · 76 °F' : 'ASHRAE Max · 24.4 °C',
            lineColor: '#D97706',
            textColor: '#FCD34D',
          },
          {
            kind: 'guideline',
            active: showGuidelines && curAxes.showTvoc,
            axisId: 'yTvoc',
            value: 100,
            label: 'TVOC Baseline · 100',
            lineColor: '#7C3AED',
            textColor: '#DDD6FE',
          },

          // Action / Exposure Limits (dashed darker)
          {
            kind: 'limit',
            active: showLimits && curAxes.showCo2,
            axisId: 'y',
            value: 1000,
            label: 'CO₂ Limit · 1000 ppm',
            lineColor: '#1E40AF',
            textColor: '#BFDBFE',
          },
          {
            kind: 'limit',
            active: showLimits && curAxes.showPm25,
            axisId: 'y1',
            value: 35.4,
            label: 'PM2.5 USG · 35.4 µg/m³',
            lineColor: '#065F46',
            textColor: '#A7F3D0',
          },
          {
            kind: 'limit',
            active: showLimits && curAxes.showAqi,
            axisId: 'yAqi',
            value: 100,
            label: 'EPA USG · 100 AQI',
            lineColor: '#9A3412',
            textColor: '#FED7AA',
          },
          {
            kind: 'limit',
            active: showLimits && curAxes.showHum,
            axisId: 'yHum',
            value: 60,
            label: 'RH High · 60%',
            lineColor: '#155E75',
            textColor: '#A5F3FC',
          },
          {
            kind: 'limit',
            active: showLimits && curAxes.showTvoc,
            axisId: 'yTvoc',
            value: 250,
            label: 'TVOC Limit · 250',
            lineColor: '#5B21B6',
            textColor: '#C4B5FD',
          },
          {
            kind: 'limit',
            active: showLimits && curAxes.showNox,
            axisId: 'yNox',
            value: 20,
            label: 'NOx Limit · 20',
            lineColor: '#9D174D',
            textColor: '#FBCFE8',
          },
          {
            kind: 'limit',
            active: showLimits && (curAxes.showTemp || curAxes.showHeatIndex),
            axisId: 'yTemp',
            value: curUnit === 'f' ? 80 : 26.7,
            label: curUnit === 'f' ? 'NWS Heat · 80 °F' : 'NWS Heat · 26.7 °C',
            lineColor: '#B45309',
            textColor: '#FDE68A',
          },
        ];

        // 1. Render only thresholds whose value falls within the active scale viewport
        ctx.save();
        ctx.beginPath();
        ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
        ctx.clip();

        for (const t of allThresholds) {
          if (!t.active) continue;
          const yScale = scales[t.axisId];
          if (!yScale) continue;
          const py = yScale.getPixelForValue(t.value);
          if (!Number.isFinite(py) || py < chartArea.top + 4 || py > chartArea.bottom - 4) {
            continue;
          }

          ctx.save();
          ctx.strokeStyle = t.lineColor;
          ctx.lineWidth = t.kind === 'limit' ? 1.5 : 1.25;
          ctx.setLineDash(t.kind === 'limit' ? [6, 4] : [2, 4]);
          ctx.beginPath();
          ctx.moveTo(chartArea.left, py);
          ctx.lineTo(chartArea.right, py);
          ctx.stroke();
          ctx.restore();

          tags.push({
            targetY: py,
            text: t.label,
            color: t.lineColor,
            textColor: t.textColor,
            side: 'left',
          });
        }

        ctx.restore();

        // 2. Moving Average endpoint canvas labels (only when inside visible chart area)
        for (let i = 0; i < data.datasets.length; i++) {
          const ds = data.datasets[i] as any;
          if (!ds?.isMovingAverage || !chart.isDatasetVisible(i)) continue;
          const meta = chart.getDatasetMeta(i);
          if (!meta?.data?.length) continue;
          const lastPoint = meta.data[meta.data.length - 1];
          if (!lastPoint) continue;
          const { x: px, y: py } = lastPoint.getProps(['x', 'y'], true);
          if (!Number.isFinite(py) || py < chartArea.top + 4 || py > chartArea.bottom - 4) {
            continue;
          }
          const rawVal = ds.data[ds.data.length - 1];
          const formattedVal = typeof rawVal === 'number' ? rawVal : '';
          tags.push({
            targetY: py,
            text: `${ds.shortCanvasLabel || ds.label}: ${formattedVal}`,
            color: ds.borderColor as string,
            textColor: '#E2E8F0',
            side: 'right',
            anchorX: px,
          });
        }

        if (tags.length === 0) return;

        // 3. Per-side collision avoidance so canvas labels never overlap
        const drawSideTags = (sideTags: OverlayTag[], side: 'left' | 'right') => {
          if (sideTags.length === 0) return;
          const sorted = [...sideTags].sort((a, b) => a.targetY - b.targetY);
          const minGap = 19;
          const minY = chartArea.top + 12;
          const maxY = chartArea.bottom - 12;

          const ys = sorted.map((t) => Math.max(minY, Math.min(maxY, t.targetY)));
          for (let i = 1; i < ys.length; i++) {
            if (ys[i] - ys[i - 1] < minGap) {
              ys[i] = ys[i - 1] + minGap;
            }
          }
          for (let i = ys.length - 1; i >= 0; i--) {
            if (ys[i] > maxY) ys[i] = maxY;
            if (i > 0 && ys[i] - ys[i - 1] < minGap) {
              ys[i - 1] = ys[i] - minGap;
            }
          }

          ctx.save();
          ctx.font = '600 10px ui-monospace, Consolas, Menlo, monospace';
          ctx.textBaseline = 'middle';

          for (let i = 0; i < sorted.length; i++) {
            const tag = sorted[i];
            const labelY = Math.max(minY, Math.min(maxY, ys[i]));
            const padX = 6;
            const boxH = 16;
            const textW = ctx.measureText(tag.text).width;
            const boxW = textW + padX * 2;
            const boxX =
              side === 'left'
                ? chartArea.left + 8
                : Math.min(chartArea.right - boxW - 6, (tag.anchorX ?? chartArea.right) - boxW - 4);
            const boxY = labelY - boxH / 2;

            if (Math.abs(labelY - tag.targetY) > 4) {
              ctx.strokeStyle = tag.color;
              ctx.lineWidth = 1;
              ctx.setLineDash([]);
              ctx.beginPath();
              if (side === 'left') {
                ctx.moveTo(chartArea.left + 2, tag.targetY);
                ctx.lineTo(boxX, labelY);
              } else {
                ctx.moveTo(boxX + boxW, labelY);
                ctx.lineTo(chartArea.right - 2, tag.targetY);
              }
              ctx.stroke();
            }

            ctx.fillStyle = 'rgba(17, 19, 24, 0.88)';
            ctx.strokeStyle = tag.color;
            ctx.lineWidth = 1;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.roundRect(boxX, boxY, boxW, boxH, 4);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = tag.textColor;
            ctx.fillText(tag.text, boxX + padX, labelY + 0.5);
          }

          ctx.restore();
        };

        drawSideTags(
          tags.filter((t) => t.side === 'left'),
          'left'
        );
        drawSideTags(
          tags.filter((t) => t.side === 'right'),
          'right'
        );
      },
    }),
    []
  );

  const hasActiveAnalytics =
    analyticsTools.movingAvgWindow > 0 ||
    analyticsTools.rollingAvgOnly ||
    !analyticsTools.showGuidelines ||
    !analyticsTools.showLimits;

  const handleResetAll = () => {
    setAxes(DEFAULT_AXES);
    setAnalyticsTools(DEFAULT_ANALYTICS_TOOLS);
  };

  const handleExportCsv = () => {
    if (activeData.length === 0) return;
    const unitTag = tempUnit.toUpperCase();
    const header = [
      'timestamp_iso',
      'co2_ppm',
      'pm1_ugm3',
      'pm25_ugm3',
      'pm10_ugm3',
      `temp_${tempUnit}`,
      'humidity_pct',
      'tvoc_index',
      'nox_index',
      'epa_aqi',
      `dew_point_${tempUnit}`,
      `heat_index_${tempUnit}`,
      'abs_humidity_gm3',
    ].join(',');

    const rows = activeData.map((d) => {
      const iso = new Date(d.timestamp * 1000).toISOString();
      const tempVal = tempUnit === 'f' ? cToF(d.atmp_comp) : d.atmp_comp;
      const aqi = calculatePm25Aqi(d.pm02_comp);
      const dpC = calculateDewPointC(d.atmp_comp, d.rhum_comp);
      const hiC = calculateHeatIndexC(d.atmp_comp, d.rhum_comp);
      const dpVal = tempUnit === 'f' ? cToF(dpC) : dpC;
      const hiVal = tempUnit === 'f' ? cToF(hiC) : hiC;
      const absHum = calculateAbsoluteHumidity(d.atmp_comp, d.rhum_comp);
      return [
        iso,
        d.rco2,
        d.pm01 ?? '',
        d.pm02_comp,
        d.pm10 ?? '',
        tempVal,
        d.rhum_comp,
        d.tvoc_index,
        d.nox_index,
        aqi,
        dpVal,
        hiVal,
        absHum,
      ].join(',');
    });

    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pigradient_${rangePreset}_${unitTag.toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Raw archive export: stream the full-fidelity 14-column raw sensor archive
  // for the active window straight from the gateway via a download anchor —
  // the browser streams the Content-Disposition response to disk without
  // buffering the whole CSV in memory
  const handleExportRawCsv = () => {
    if (activeData.length === 0 || isExportingRaw) return;
    setIsExportingRaw(true);
    try {
      // Live view (5m): export up to "now". Historical presets: cover the full
      // requested window — the newest bucket's start timestamp alone would
      // truncate up to interval-1 seconds (or everything with one bucket).
      const rangeEnd = isLiveStreaming
        ? Math.floor(Date.now() / 1000)
        : activeData[activeData.length - 1].timestamp + RANGE_INTERVAL_SEC[rangePreset] - 1;
      const rangeStart = isLiveStreaming
        ? rangeEnd - RANGE_WINDOW_SEC[rangePreset]
        : activeData[0].timestamp;
      const a = document.createElement('a');
      a.href = `${import.meta.env.BASE_URL}api/v1/export.csv?start=${rangeStart}&end=${rangeEnd}`;
      a.download = `pigradient_raw_${rangeStart}-${rangeEnd}.csv`;
      a.click();
    } finally {
      setIsExportingRaw(false);
    }
  };

  const chartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: prefs.reduceMotion || isLiveStreaming ? false : { duration: 250 },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: '#CBD5E1',
          font: { family: 'system-ui, sans-serif', size: 11 },
          usePointStyle: prefs.colorblindSafe,
          boxWidth: prefs.colorblindSafe ? 10 : 16,
          boxHeight: prefs.colorblindSafe ? 8 : 3,
          padding: 20,
          filter: (legendItem, chartDataArg) =>
            !(chartDataArg.datasets[legendItem.datasetIndex ?? -1] as any)?.hideFromLegend,
          generateLabels: (chart) => {
            const base = ChartJS.defaults.plugins.legend.labels.generateLabels(chart);
            return base.map((item) => {
              const ds = chart.data.datasets[item.datasetIndex ?? -1] as any;
              if (ds?.borderColor) {
                item.fillStyle = ds.borderColor;
                item.strokeStyle = ds.borderColor;
                item.lineWidth = 0;
              }
              if (prefs.colorblindSafe && ds?.pointStyle) {
                item.pointStyle = ds.pointStyle;
              }
              return item;
            });
          },
        },
      },
      tooltip: {
        backgroundColor: '#181b22',
        titleColor: '#F8FAFC',
        bodyColor: '#CBD5E1',
        borderColor: 'rgba(148,163,184,0.22)',
        borderWidth: 1,
        padding: 10,
        bodyFont: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 11 },
        titleFont: { family: 'system-ui, sans-serif', size: 11, weight: 'bold' },
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(148, 163, 184, 0.08)' },
        ticks: {
          color: '#7e8596',
          font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
        },
      },
      y: {
        type: 'linear',
        display: axes.showCo2,
        position: 'left',
        title: { display: true, text: 'CO₂ (ppm)', color: '#60a5fa', font: { size: 10 } },
        grid: { color: 'rgba(148, 163, 184, 0.1)' },
        ticks: { color: '#9ca3af', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      y1: {
        type: 'linear',
        display: axes.showPm25 || axes.showPm1 || axes.showPm10,
        position: 'right',
        title: {
          display: true,
          text: axes.showPm1 || axes.showPm10 ? 'PM (µg/m³)' : 'PM2.5 (µg/m³)',
          color: '#34d399',
          font: { size: 10 },
        },
        grid: { drawOnChartArea: false },
        ticks: { color: '#9ca3af', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      yTemp: {
        type: 'linear',
        display: axes.showTemp || axes.showDewPoint || axes.showHeatIndex,
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#F59E0B', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      yHum: {
        type: 'linear',
        display: axes.showHum,
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#06B6D4', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      yTvoc: {
        type: 'linear',
        display: axes.showTvoc,
        position: 'left',
        grid: { drawOnChartArea: false },
        ticks: { color: '#8B5CF6', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      yNox: {
        type: 'linear',
        display: axes.showNox,
        position: 'left',
        grid: { drawOnChartArea: false },
        ticks: { color: '#EC4899', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      yAqi: {
        type: 'linear',
        display: axes.showAqi,
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#F97316', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
      yAbsHum: {
        type: 'linear',
        display: axes.showAbsHumidity,
        position: 'right',
        grid: { drawOnChartArea: false },
        ticks: { color: '#14B8A6', font: { family: 'ui-monospace, Consolas, Menlo, monospace', size: 10 } },
      },
    },
  };

  if (!telemetry) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-[#9ca3af]">
        <RefreshCw className="w-7 h-7 animate-spin text-[#60a5fa] mb-3" aria-hidden="true" />
        <p className="text-sm">Connecting to local AirGradient telemetry stream...</p>
      </div>
    );
  }

  const { raw, processed } = telemetry;
  const hasTelemetry = telemetry.timestamp > 0;
  const isMonitorDisconnected = !hasTelemetry || telemetry.status === 'offline';
  // Stale telemetry: no SSE frame for >10s — last-known values are frozen, so
  // grey the KPI cards out instead of presenting them as live readings
  const isStale = telemetryStale && hasTelemetry;
  const staleAgoSec = isStale ? Math.max(1, staleSeconds) : 0;

  const co2StatusLabel = !hasTelemetry
    ? 'No Data'
    : processed.co2_category === 'optimal'
    ? 'Good'
    : processed.co2_category === 'fair'
    ? 'Moderate'
    : processed.co2_category === 'poor'
    ? 'Elevated'
    : 'High';
  const displayTemp = tempUnit === 'f' ? processed.temp_f : processed.temp_c;
  const displayDew = tempUnit === 'f' ? processed.dew_point_f : processed.dew_point_c;
  const displayHeatIndex = tempUnit === 'f' ? processed.heat_index_f : processed.heat_index_c;
  const co2Pct = hasTelemetry
    ? Math.min(100, Math.max(0, ((raw.rco2 - 400) / (1800 - 400)) * 100))
    : 0;

  const chemStatus = !hasTelemetry
    ? {
        label: 'No Data',
        colorClass: 'text-[#8f96a6]',
        tip: 'Awaiting Sensirion SGP41 VOC & NOx readings from monitor',
      }
    : raw.tvoc_index >= 400 || raw.nox_index >= 100
    ? {
        label: 'High',
        colorClass: 'text-rose-400',
        tip: 'High VOC (≥400) or NOx (≥100) concentrations detected — increase ventilation',
      }
    : raw.tvoc_index >= 250 || raw.nox_index >= 20
    ? {
        label: 'Elevated',
        colorClass: 'text-amber-400',
        tip: 'Elevated VOCs (≥250) or NOx (≥20) above the 24h indoor baseline',
      }
    : raw.tvoc_index >= 150 || raw.nox_index >= 5
    ? {
        label: 'Moderate',
        colorClass: 'text-sky-400',
        tip: 'Mildly above clean indoor ambient baseline (TVOC 100 / NOx 1)',
      }
    : {
        label: 'Normal',
        colorClass: 'text-emerald-400',
        tip: 'Normal ambient baseline (TVOC <150, NOx <5)',
      };

  const aqiAccentColor = hasTelemetry ? processed.aqi_color : '#475569';

  return (
    <div className="space-y-4 sm:space-y-5 max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
      {(isMonitorDisconnected || isStale) && (
        <MatCard className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-amber-500/25 bg-[#1b1918]">
          <div className="flex items-start sm:items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
              <WifiOff className="w-4 h-4 text-amber-400" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-[13px] font-semibold text-white">
                {!hasTelemetry
                  ? 'No AirGradient monitor configured or reachable yet'
                  : isStale
                  ? `No signal — last seen ${staleAgoSec}s ago`
                  : 'Monitor disconnected — showing last known values'}
              </p>
              <p className="text-xs text-[#9ca3af] mt-0.5 truncate">
                {isStale
                  ? 'Live frames stopped — KPI values below are the last archived snapshot, not live readings.'
                  : telemetry.error_message
                  ? `Status: ${telemetry.error_message}. Set your monitor LAN IP or mDNS address in Connectivity.`
                  : 'Configure your monitor LAN IP or mDNS address in Device Controls → Connectivity.'}
              </p>
            </div>
          </div>

          {onOpenConnectivity && (
            <MatButton
              variant="tonal"
              size="sm"
              onClick={onOpenConnectivity}
              className="shrink-0 w-full sm:w-auto"
            >
              Configure Connectivity
            </MatButton>
          )}
        </MatCard>
      )}

      {/* 1. Material KPI Row */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 transition-opacity duration-300 ${
          isStale ? 'opacity-50 saturate-50' : ''
        }`}
        aria-disabled={isStale || undefined}
      >
        {/* Card 1: Air Quality & Particulate Spectrum (PMS5003) */}
        <MatCard
          className="p-4 flex flex-col justify-between relative overflow-hidden"
          title="Plantower PMS5003 particulate spectrum and US EPA 2021 humidity-compensated PM2.5 Air Quality Index"
        >
          <div
            className="absolute top-0 left-0 right-0 h-1"
            style={{ backgroundColor: aqiAccentColor }}
          />
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[#9ca3af]">Air Quality</span>
              <span
                className="text-xs font-medium truncate cursor-help"
                style={{ color: hasTelemetry ? processed.aqi_color : '#8f96a6' }}
                title={
                  hasTelemetry
                    ? `EPA AQI Category: ${processed.aqi_category} (${processed.aqi_pm25} AQI)`
                    : 'Awaiting PM2.5 readings from monitor'
                }
              >
                {hasTelemetry ? processed.aqi_category : 'No Data'}
              </span>
            </div>

            <div className="flex items-baseline justify-between gap-2 my-1">
              <div title="US EPA Air Quality Index derived from compensated PM2.5">
                <span
                  className="text-3xl font-bold font-mono tabular-nums tracking-tight"
                  style={{ color: hasTelemetry ? processed.aqi_color : '#9ca3af' }}
                >
                  {hasTelemetry ? processed.aqi_pm25 : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] ml-1.5">AQI</span>
              </div>
              <div
                className="text-right"
                title={
                  hasTelemetry
                    ? `EPA 2021 humidity-compensated PM2.5 (Raw PMS5003: ${raw.pm02} µg/m³)`
                    : 'EPA 2021 humidity-compensated PM2.5'
                }
              >
                <span className="text-2xl font-bold font-mono tabular-nums text-white tracking-tight">
                  {hasTelemetry ? raw.pm02_comp : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] ml-1">µg/m³</span>
              </div>
            </div>
          </div>

          <div>
            <MatDivider className="my-2.5" />
            <div className="flex items-center justify-between gap-1.5 text-[11px] sm:text-xs text-[#9ca3af] font-mono tabular-nums whitespace-nowrap">
              <span
                className="cursor-help"
                title="Ultrafine particulate matter ≤1.0 µm diameter (µg/m³)"
              >
                PM1 <strong className="text-[#e6e8ee]">{hasTelemetry ? raw.pm01 : '--'}</strong>
              </span>
              <span
                className="cursor-help"
                title="Raw uncompensated PMS5003 PM2.5 reading (µg/m³)"
              >
                Raw <strong className="text-[#cbd5e1]">{hasTelemetry ? raw.pm02 : '--'}</strong>
              </span>
              <span
                className="cursor-help"
                title="Coarse particulate matter ≤10 µm diameter (µg/m³)"
              >
                PM10 <strong className="text-[#e6e8ee]">{hasTelemetry ? raw.pm10 : '--'}</strong>
              </span>
            </div>
          </div>
        </MatCard>

        {/* Card 2: CO2 ppm */}
        <MatCard
          className="p-4 flex flex-col justify-between"
          title="Senseair NDIR CO₂ concentration (Ambient ~420 ppm · Good <800 · Limit 1000 · High ≥1400)"
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[#9ca3af]">Carbon Dioxide</span>
              <span
                title={hasTelemetry ? processed.co2_level : 'Awaiting Senseair NDIR reading'}
                className={`text-xs font-medium cursor-help ${
                  !hasTelemetry
                    ? 'text-[#8f96a6]'
                    : processed.co2_category === 'optimal'
                    ? 'text-emerald-400'
                    : processed.co2_category === 'fair'
                    ? 'text-amber-400'
                    : processed.co2_category === 'poor'
                    ? 'text-orange-400'
                    : 'text-rose-400'
                }`}
              >
                {co2StatusLabel}
              </span>
            </div>

            <div className="flex items-baseline gap-2 my-1">
              <span className="text-3xl font-bold font-mono tabular-nums text-white tracking-tight">
                {hasTelemetry ? raw.rco2 : '--'}
              </span>
              <span className="text-xs text-[#9ca3af]">ppm</span>
            </div>

            <div
              className="w-full bg-[#111318] h-1.5 rounded-full overflow-hidden mt-2"
              title={
                hasTelemetry
                  ? `${raw.rco2} ppm CO₂ indoor saturation gauge`
                  : 'Awaiting monitor readings'
              }
            >
              <div
                className={`h-full transition-all duration-300 ${
                  !hasTelemetry
                    ? 'bg-slate-700'
                    : raw.rco2 < 800
                    ? 'bg-emerald-500'
                    : raw.rco2 < 1000
                    ? 'bg-amber-500'
                    : 'bg-rose-500'
                }`}
                style={{ width: `${co2Pct}%` }}
              />
            </div>
          </div>

          <div>
            <MatDivider className="my-2.5" />
            <div
              className="text-xs text-[#9ca3af] truncate"
              title={hasTelemetry ? processed.co2_level : 'Awaiting monitor readings'}
            >
              {hasTelemetry ? processed.co2_level : 'Awaiting monitor readings'}
            </div>
          </div>
        </MatCard>

        {/* Card 3: Climate */}
        <MatCard
          className="p-4 flex flex-col justify-between"
          title="Self-heating-compensated Temperature, Relative Humidity, Dew Point, and NWS Heat Index"
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[#9ca3af]">Climate</span>
              <MatButton
                variant="text"
                size="sm"
                onClick={() => setTempUnit(tempUnit === 'f' ? 'c' : 'f')}
                title={`Switch temperature charts & cards to °${tempUnit === 'f' ? 'C' : 'F'}`}
                className="!min-h-[24px] !px-1.5 !py-0 text-xs font-medium"
              >
                °{tempUnit === 'f' ? 'C' : 'F'}
              </MatButton>
            </div>

            <div className="flex items-baseline justify-between my-1">
              <div title="Heat-compensated ambient air temperature">
                <span className="text-3xl font-bold font-mono tabular-nums text-white tracking-tight">
                  {hasTelemetry ? displayTemp : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] ml-1">°{tempUnit.toUpperCase()}</span>
              </div>
              <div className="text-right" title="Compensated relative humidity (ideal 40–60%)">
                <span className="text-2xl font-bold font-mono tabular-nums text-sky-400 tracking-tight">
                  {hasTelemetry ? raw.rhum_comp : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] ml-1">% RH</span>
              </div>
            </div>
          </div>

          <div>
            <MatDivider className="my-2.5" />
            <div className="flex items-center justify-between gap-2 text-xs text-[#9ca3af]">
              <span
                className="truncate cursor-help"
                title="Magnus Dew Point — temperature at which indoor moisture condenses"
              >
                Dew:{' '}
                <strong className="text-[#cbd5e1] font-mono tabular-nums">
                  {hasTelemetry ? `${displayDew}°${tempUnit.toUpperCase()}` : '--'}
                </strong>
              </span>
              <span
                className="truncate cursor-help"
                title="NWS Rothfusz Heat Index — perceived thermal stress combining heat & humidity"
              >
                Heat:{' '}
                <strong className="text-[#cbd5e1] font-mono tabular-nums">
                  {hasTelemetry ? `${displayHeatIndex}°` : '--'}
                </strong>
              </span>
            </div>
          </div>
        </MatCard>

        {/* Card 4: Chemical VOCs */}
        <MatCard
          className="p-4 flex flex-col justify-between"
          title="Sensirion SGP41 adaptive VOC & NOx Gas Index (1–500 scale relative to 24h ambient baseline)"
        >
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium text-[#9ca3af]">Chemical VOCs</span>
              <span
                className={`text-xs font-medium cursor-help ${chemStatus.colorClass}`}
                title={chemStatus.tip}
              >
                {chemStatus.label}
              </span>
            </div>

            <div className="flex items-baseline justify-between my-1">
              <div title="TVOC Gas Index: 100 = 24h indoor baseline; ≥250 elevated; 500 max">
                <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-cyan-400 tracking-tight">
                  {hasTelemetry ? raw.tvoc_index : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] ml-1.5">TVOC</span>
              </div>
              <div
                className="text-right"
                title="NOx Gas Index: 1 = clean ambient baseline; ≥20 combustion/cooking exhaust; 500 max"
              >
                <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-indigo-400 tracking-tight">
                  {hasTelemetry ? raw.nox_index : '--'}
                </span>
                <span className="text-xs text-[#9ca3af] ml-1.5">NOx</span>
              </div>
            </div>
          </div>

          <div>
            <MatDivider className="my-2.5" />
            <div className="flex items-center justify-between gap-2 text-xs text-[#9ca3af]">
              <span title="Sensirion SGP41 MOX gas sensor module">Sensirion SGP41</span>
              <span
                className="font-mono text-[#7e8596]"
                title="100 is TVOC baseline; 1 is NOx ambient baseline (max 500)"
              >
                1–500 Index
              </span>
            </div>
          </div>
        </MatCard>
      </div>

      {/* 2. Interactive Telemetry Time-Series Card */}
      <MatCard className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div className="flex items-center min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-white tracking-tight font-display truncate">
              Telemetry Time-Series
            </h2>
          </div>

          <div className="flex items-center gap-2 w-full lg:w-auto">
            <MatButton
              variant="tonal"
              size="sm"
              onClick={() => setIsLiveStreaming(!isLiveStreaming)}
              aria-pressed={!isLiveStreaming}
              title={
                isLiveStreaming
                  ? 'Pause incoming live chart updates'
                  : 'Resume live chart stream'
              }
              icon={
                isLiveStreaming ? (
                  <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                )
              }
            >
              {isLiveStreaming ? 'Pause' : 'Resume'}
            </MatButton>

            <MatSegmentedButton
              ariaLabel="Time range presets"
              options={TIME_PRESETS}
              value={rangePreset}
              onChange={(id) => setRangePreset(id as TimeRangePreset)}
              fullWidthOnMobile
              className="min-w-0 flex-1 lg:flex-initial"
            />
          </div>
        </div>

        {/* Series Selection Checkboxes + Progressive Analytical Controls */}
        <div className="space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-3 sm:flex sm:flex-wrap xl:flex-nowrap items-center gap-x-1 sm:gap-x-1 xl:gap-x-1.5 gap-y-0.5">
                <MatCheckbox
                  checked={axes.showCo2}
                  onChange={(checked) => setAxes((a) => ({ ...a, showCo2: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="CO₂ concentration in ppm (Senseair NDIR)"
                  label={<span className="text-xs text-[#93c5fd] whitespace-nowrap">CO₂</span>}
                />
                <MatCheckbox
                  checked={axes.showPm1}
                  onChange={(checked) => setAxes((a) => ({ ...a, showPm1: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="Ultrafine particulate matter ≤1.0 µm in µg/m³ (smoke & combustion aerosols)"
                  label={<span className="text-xs text-lime-400 whitespace-nowrap">PM1.0</span>}
                />
                <MatCheckbox
                  checked={axes.showPm25}
                  onChange={(checked) => setAxes((a) => ({ ...a, showPm25: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="EPA 2021 humidity-compensated PM2.5 in µg/m³"
                  label={<span className="text-xs text-emerald-400 whitespace-nowrap">PM2.5</span>}
                />
                <MatCheckbox
                  checked={axes.showPm10}
                  onChange={(checked) => setAxes((a) => ({ ...a, showPm10: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="Coarse particulate matter ≤10 µm in µg/m³ (dust, pollen & dander estimate)"
                  label={<span className="text-xs text-indigo-400 whitespace-nowrap">PM10</span>}
                />
                <MatCheckbox
                  checked={axes.showTemp}
                  onChange={(checked) => setAxes((a) => ({ ...a, showTemp: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title={`Compensated temperature (°${tempUnit.toUpperCase()})`}
                  label={<span className="text-xs text-amber-400 whitespace-nowrap">Temp</span>}
                />
                <MatCheckbox
                  checked={axes.showHum}
                  onChange={(checked) => setAxes((a) => ({ ...a, showHum: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="Compensated relative humidity (% RH)"
                  label={<span className="text-xs text-cyan-400 whitespace-nowrap">Humidity</span>}
                />
                <MatCheckbox
                  checked={axes.showTvoc}
                  onChange={(checked) => setAxes((a) => ({ ...a, showTvoc: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="Sensirion SGP41 TVOC Gas Index (1–500; 100 baseline)"
                  label={<span className="text-xs text-purple-400 whitespace-nowrap">TVOC</span>}
                />
                <MatCheckbox
                  checked={axes.showNox}
                  onChange={(checked) => setAxes((a) => ({ ...a, showNox: checked }))}
                  className="!gap-1 !px-1 shrink-0"
                  title="Sensirion SGP41 NOx Gas Index (1–500; 1 ambient)"
                  label={<span className="text-xs text-pink-400 whitespace-nowrap">NOx</span>}
                />

                <span
                  aria-hidden="true"
                  className="hidden sm:inline-block h-4 w-px bg-white/[0.12] mx-0.5 shrink-0"
                />

                <div className="col-span-3 sm:contents">
                  <div className="grid grid-cols-2 min-[420px]:grid-cols-4 sm:contents gap-x-1 gap-y-0.5 pt-1 sm:pt-0 border-t border-white/[0.06] sm:border-t-0">
                    <MatCheckbox
                      checked={axes.showAqi}
                      onChange={(checked) => setAxes((a) => ({ ...a, showAqi: checked }))}
                      className="!gap-1 !px-1 shrink-0"
                      title="Derived US EPA Air Quality Index (0–500) calculated from compensated PM2.5"
                      label={<span className="text-xs text-orange-400 whitespace-nowrap">EPA AQI</span>}
                    />
                    <MatCheckbox
                      checked={axes.showDewPoint}
                      onChange={(checked) => setAxes((a) => ({ ...a, showDewPoint: checked }))}
                      className="!gap-1 !px-1 shrink-0"
                      title={`Derived Magnus Dew Point (°${tempUnit.toUpperCase()}) showing condensation temperature`}
                      label={<span className="text-xs text-sky-400 whitespace-nowrap">Dew Pt</span>}
                    />
                    <MatCheckbox
                      checked={axes.showHeatIndex}
                      onChange={(checked) => setAxes((a) => ({ ...a, showHeatIndex: checked }))}
                      className="!gap-1 !px-1 shrink-0"
                      title={`Derived NWS Heat Index (°${tempUnit.toUpperCase()}) apparent felt temperature`}
                      label={<span className="text-xs text-rose-400 whitespace-nowrap">Heat Idx</span>}
                    />
                    <MatCheckbox
                      checked={axes.showAbsHumidity}
                      onChange={(checked) => setAxes((a) => ({ ...a, showAbsHumidity: checked }))}
                      className="!gap-1 !px-1 shrink-0"
                      title="Derived Absolute Humidity in g/m³ (actual airborne water vapor mass)"
                      label={<span className="text-xs text-teal-400 whitespace-nowrap">Abs Hum</span>}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-1.5 shrink-0">
              <MatButton
                variant={showAnalyticsPanel || hasActiveAnalytics ? 'tonal' : 'text'}
                size="sm"
                className="!px-2.5"
                onClick={() => setShowAnalyticsPanel((prev) => !prev)}
                aria-expanded={showAnalyticsPanel}
                title="Toggle analytical overlays, moving averages, rolling-only mode, thresholds, and stats table"
                icon={<SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                Analytics
              </MatButton>
              <MatButton
                variant="text"
                size="sm"
                className="!px-2.5"
                onClick={handleResetAll}
                title="Reset chart series and analytics options back to defaults"
                icon={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                Reset
              </MatButton>
              <MatButton
                variant="outlined"
                size="sm"
                className="!px-2.5"
                onClick={() => fetchHistoricalData(rangePreset)}
                title="Reload historical data points for the selected time window"
                icon={
                  <RefreshCw
                    aria-hidden="true"
                    className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`}
                  />
                }
              >
                Refresh
              </MatButton>
            </div>
          </div>

          {showAnalyticsPanel && (
            <div className="rounded-xl bg-[#111318] border border-white/[0.08] p-3.5 sm:p-4 space-y-3.5">
              {/* Analytical Overlays & CSV Export */}
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="text-xs font-medium text-[#cbd5e1] whitespace-nowrap cursor-help"
                      title={`Smooth fluctuations using a trailing Simple Moving Average scaled to the active ${RANGE_INTERVAL_SEC[rangePreset]}s resolution`}
                    >
                      Moving Avg
                    </span>
                    <MatSegmentedButton
                      ariaLabel="Moving average window"
                      options={[
                        { id: '0', label: 'Off', title: 'Show unsmoothed telemetry points' },
                        ...MOVING_AVG_WINDOWS.map((w) => {
                          const dur = formatWindowDuration(w, RANGE_INTERVAL_SEC[rangePreset]);
                          return {
                            id: String(w),
                            label: dur,
                            title: `${dur} trailing average (${w} samples × ${RANGE_INTERVAL_SEC[rangePreset]}s cadence)`,
                          };
                        }),
                      ]}
                      value={String(analyticsTools.movingAvgWindow)}
                      onChange={(id) => {
                        const win = Number(id) as MovingAvgWindow;
                        setAnalyticsTools((t) => ({
                          ...t,
                          movingAvgWindow: win,
                          rollingAvgOnly: win === 0 ? false : t.rollingAvgOnly,
                        }));
                      }}
                    />
                  </div>

                  <MatCheckbox
                    checked={analyticsTools.rollingAvgOnly}
                    onChange={(checked) =>
                      setAnalyticsTools((t) => ({
                        ...t,
                        rollingAvgOnly: checked,
                        movingAvgWindow:
                          checked && t.movingAvgWindow === 0 ? 15 : t.movingAvgWindow,
                      }))
                    }
                    className="!px-1.5"
                    title={`Hide raw telemetry lines and display only the smoothed rolling average curves (defaults to ${formatWindowDuration(15, RANGE_INTERVAL_SEC[rangePreset])} if Off)`}
                    label={
                      <span className="text-xs text-[#cbd5e1] whitespace-nowrap">
                        Rolling Avg Only
                      </span>
                    }
                  />

                  <MatCheckbox
                    checked={analyticsTools.showGuidelines}
                    onChange={(checked) =>
                      setAnalyticsTools((t) => ({ ...t, showGuidelines: checked }))
                    }
                    className="!px-1.5"
                    title="Show clean/comfort target lines when in view (CO₂ 800, PM2.5 12, EPA 50, RH Min 30%, ASHRAE 76°F, TVOC 100)"
                    label={
                      <span className="text-xs text-[#cbd5e1] whitespace-nowrap">
                        Guidelines
                      </span>
                    }
                  />

                  <MatCheckbox
                    checked={analyticsTools.showLimits}
                    onChange={(checked) =>
                      setAnalyticsTools((t) => ({ ...t, showLimits: checked }))
                    }
                    className="!px-1.5"
                    title="Show exposure & ventilation action limits when in view (CO₂ 1000, PM2.5 USG 35.4, EPA USG 100, RH High 60%, TVOC 250, NOx 20, NWS Heat 80°F)"
                    label={
                      <span className="text-xs text-[#cbd5e1] whitespace-nowrap">
                        Limits
                      </span>
                    }
                  />
                </div>

                <div className="flex flex-col items-end gap-1.5 self-end xl:self-auto">
                  <MatButton
                    variant="outlined"
                    size="sm"
                    onClick={handleExportCsv}
                    disabled={activeData.length === 0}
                    title="Download the visible (downsampled) chart history including processed EPA AQI, Dew Point, Heat Index, and Abs Humidity as CSV"
                    icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    Export Chart CSV
                  </MatButton>
                  <MatButton
                    variant="outlined"
                    size="sm"
                    onClick={handleExportRawCsv}
                    disabled={activeData.length === 0 || isExportingRaw}
                    title="Stream the full-fidelity 14-column raw sensor archive for the active time window from the gateway as CSV"
                    icon={<Database className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    {isExportingRaw ? 'Exporting…' : 'Raw Archive CSV (full fidelity)'}
                  </MatButton>
                  <span className="text-[10px] text-[#7e8596] text-right leading-tight">
                    Chart CSV exports the downsampled points on screen · Raw Archive CSV
                    streams every archived 1s sample for the window
                  </span>
                </div>
              </div>

              {/* Window Statistical Summary for Active Series */}
              {summaryRows.length > 0 && (
                <>
                  <MatDivider />
                  <div className="overflow-x-auto no-scrollbar">
                    <table className="w-full min-w-[460px] table-fixed text-left text-xs font-mono tabular-nums">
                      <colgroup>
                        <col className="w-[28%]" />
                        <col className="w-[14%]" />
                        <col className="w-[14%]" />
                        <col className="w-[14%]" />
                        <col className="w-[14%]" />
                        <col className="w-[16%]" />
                      </colgroup>
                      <thead>
                        <tr className="text-[11px] font-sans text-[#8f96a6] border-b border-white/[0.06]">
                          <th className="py-1.5 pr-3 font-medium">Series</th>
                          <th
                            className="py-1.5 px-2 font-medium text-right cursor-help"
                            title="Minimum value recorded in visible window"
                          >
                            Min
                          </th>
                          <th
                            className="py-1.5 px-2 font-medium text-right cursor-help"
                            title="Arithmetic mean across visible window"
                          >
                            Avg
                          </th>
                          <th
                            className="py-1.5 px-2 font-medium text-right cursor-help"
                            title="Maximum value recorded in visible window"
                          >
                            Max
                          </th>
                          <th
                            className="py-1.5 px-2 font-medium text-right cursor-help"
                            title="Population standard deviation (σ) measuring volatility"
                          >
                            σ
                          </th>
                          <th
                            className="py-1.5 pl-2 font-medium text-right cursor-help"
                            title="Net change from start to end of visible window"
                          >
                            Δ Net
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {summaryRows.map((row) => (
                          <tr key={row.id}>
                            <td className={`py-1.5 pr-3 font-sans font-medium truncate ${row.colorClass}`}>
                              {row.label}{' '}
                              <span className="text-[10px] font-mono text-[#7e8596]">
                                ({row.unit})
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#cbd5e1] whitespace-nowrap">
                              {row.stats.min.toFixed(1)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-white font-semibold whitespace-nowrap">
                              {row.stats.avg.toFixed(1)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#cbd5e1] whitespace-nowrap">
                              {row.stats.max.toFixed(1)}
                            </td>
                            <td className="py-1.5 px-2 text-right text-[#9ca3af] whitespace-nowrap">
                              {row.stats.stdDev.toFixed(1)}
                            </td>
                            <td
                              className={`py-1.5 pl-2 text-right whitespace-nowrap ${
                                row.stats.delta > 0
                                  ? 'text-amber-400'
                                  : row.stats.delta < 0
                                  ? 'text-emerald-400'
                                  : 'text-[#9ca3af]'
                              }`}
                            >
                              {row.stats.delta > 0
                                ? `+${row.stats.delta.toFixed(1)}`
                                : row.stats.delta.toFixed(1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Chart Viewport */}
        <div
          role="region"
          aria-label="Environmental telemetry time-series chart"
          className="h-[290px] sm:h-[390px] w-full relative"
        >
          {isLoadingHistory && (
            <div className="absolute inset-0 bg-[#181b22]/75 backdrop-blur-xs flex items-center justify-center z-10 rounded-lg">
              <RefreshCw className="w-5 h-5 animate-spin text-[#60a5fa]" aria-hidden="true" />
            </div>
          )}
          {!isLoadingHistory && activeData.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none px-4 text-center">
              <p className="text-xs sm:text-sm font-medium text-[#cbd5e1]">
                No telemetry recorded in this window
              </p>
              <p className="text-xs text-[#8f96a6] mt-1">
                Connect your AirGradient monitor in Device Controls → Connectivity to begin archiving.
              </p>
            </div>
          )}
          <Line data={chartData} options={chartOptions} plugins={[canvasOverlayPlugin]} />
        </div>

        {/* Chart Footer Strip: Stream Status & Signal Reference */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-white/[0.06] text-xs">
          <div className="flex items-center gap-2.5">
            {isLiveStreaming ? (
              <span
                className="font-mono font-medium text-emerald-400 cursor-help"
                title={
                  rangePreset === '5m'
                    ? 'Appending live 1 Hz Server-Sent Events directly from PiGradient gateway'
                    : `Live bucketed stream (${formatWindowDuration(1, RANGE_INTERVAL_SEC[rangePreset])} resolution, updating every ${LIVE_CADENCE_SEC[rangePreset]}s when changes are perceptible)`
                }
              >
                {rangePreset === '5m'
                  ? '· 1s Live Stream'
                  : `· Live (${formatWindowDuration(1, RANGE_INTERVAL_SEC[rangePreset])} buckets · ${activeData.length} samples)`}
              </span>
            ) : (
              <span
                className="font-mono font-medium text-amber-400 cursor-help"
                title="Live chart buffer updates paused — press Resume to continue streaming"
              >
                {rangePreset === '5m'
                  ? '· Stream Paused'
                  : `· Stream Paused (${rangePreset} · ${activeData.length} samples)`}
              </span>
            )}
          </div>

          <MatButton
            variant="text"
            size="sm"
            className="!min-h-[28px] !px-2 !py-1 text-[#9ca3af] hover:text-[#93c5fd]"
            onClick={() => setShowReferenceModal(true)}
            title="Explain all signals, Guidelines vs. Limits thresholds, statuses, and sources"
            icon={<HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />}
          >
            Signals &amp; Limits Guide
          </MatButton>
        </div>
      </MatCard>

      <SignalReferenceDialog
        open={showReferenceModal}
        onClose={() => setShowReferenceModal(false)}
        tempUnit={tempUnit}
      />
    </div>
  );
};
