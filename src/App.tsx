import React, { useState, useEffect, useRef } from 'react';
import { Accessibility } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { ConsoleView } from './components/ConsoleView';
import { SettingsView } from './components/SettingsView';
import { LogsView } from './components/LogsView';
import { LiveTelemetryPayload, SystemStats } from './types/telemetry';
import {
  AccessibilityDialog,
  AccessibilityProvider,
  useAccessibility,
} from './contexts/AccessibilityContext';

// No SSE frame for longer than this marks live telemetry stale (frozen KPIs)
const TELEMETRY_STALE_AFTER_SEC = 10;

function AppShell() {
  const [activeTab, setActiveTab] = useState<'monitor' | 'controls' | 'system'>('monitor');
  const [controlsSubTab, setControlsSubTab] = useState<
    'led_display' | 'calibration' | 'firmware' | 'connectivity'
  >('led_display');
  const [telemetry, setTelemetry] = useState<LiveTelemetryPayload | null>(null);
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [isStreamConnected, setIsStreamConnected] = useState<boolean>(false);
  const [isTelemetryStale, setIsTelemetryStale] = useState<boolean>(false);
  const [staleSeconds, setStaleSeconds] = useState<number>(0);
  const lastTelemetryAtRef = useRef<number>(0);
  const [showA11yModal, setShowA11yModal] = useState<boolean>(false);
  const [tempUnit, setTempUnit] = useState<'f' | 'c'>(() => {
    return (localStorage.getItem('pigradient_temp_unit') as 'f' | 'c') || 'f';
  });

  const { prefs } = useAccessibility();
  const activeA11yCount = [
    prefs.highContrast,
    prefs.largeText,
    prefs.reduceMotion,
    prefs.colorblindSafe,
  ].filter(Boolean).length;

  const handleSetTempUnit = (unit: 'f' | 'c') => {
    setTempUnit(unit);
    localStorage.setItem('pigradient_temp_unit', unit);
  };

  const fetchLiveAndSystem = async () => {
    try {
      const [liveRes, sysRes] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}api/v1/live`),
        fetch(`${import.meta.env.BASE_URL}api/v1/system`),
      ]);

      if (liveRes.ok) {
        const liveData = await liveRes.json();
        setTelemetry(liveData);
        // Anchor to the sample's reported age, not arrival time: a cached
        // /api/v1/live payload can already be seconds old
        lastTelemetryAtRef.current =
          liveData.last_seen_seconds_ago >= 0
            ? Date.now() - liveData.last_seen_seconds_ago * 1000
            : Date.now();
      }
      if (sysRes.ok) {
        const sysData = await sysRes.json();
        setSystemStats(sysData);
      }
    } catch {
      // Transient startup network error; SSE retry will hydrate state cleanly
    }
  };

  useEffect(() => {
    fetchLiveAndSystem();
  }, []);

  // Connect to SSE stream (/api/v1/stream)
  useEffect(() => {
    let evtSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = () => {
      evtSource = new EventSource(`${import.meta.env.BASE_URL}api/v1/stream`);

      evtSource.onopen = () => {
        setIsStreamConnected(true);
      };

      evtSource.onmessage = (event) => {
        try {
          const data: LiveTelemetryPayload = JSON.parse(event.data);
          setTelemetry(data);
          // Anchor to the sample's reported age: status broadcasts re-sent
          // during monitor outages must not reset the staleness watchdog
          lastTelemetryAtRef.current =
            data.last_seen_seconds_ago >= 0
              ? Date.now() - data.last_seen_seconds_ago * 1000
              : Date.now();
          setIsStreamConnected(true);
        } catch {
          // Ignore malformed SSE frame
        }
      };

      evtSource.onerror = () => {
        setIsStreamConnected(false);
        evtSource?.close();
        reconnectTimeout = setTimeout(connectSSE, 3000);
      };
    };

    connectSSE();

    const sysInterval = setInterval(async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/v1/system`);
        if (res.ok) {
          const data = await res.json();
          setSystemStats(data);
        }
      } catch {}
    }, 5000);

    return () => {
      evtSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      clearInterval(sysInterval);
    };
  }, []);

  // Telemetry staleness watchdog: the SSE stream carries ~1 Hz frames plus
  // collector status broadcasts. If no frame has arrived for >10s (e.g. monitor
  // offline between status transitions), mark the payload stale so the UI greys
  // out the frozen last-known values instead of presenting them as live.
  useEffect(() => {
    const elapsedSec = () =>
      lastTelemetryAtRef.current > 0
        ? Math.floor((Date.now() - lastTelemetryAtRef.current) / 1000)
        : 0;

    const watchdog = setInterval(() => {
      setIsTelemetryStale(elapsedSec() > TELEMETRY_STALE_AFTER_SEC);
    }, 2000);

    return () => clearInterval(watchdog);
  }, []);

  // While stale, keep a per-second "last seen Xs ago" counter for the KPI cards
  useEffect(() => {
    if (!isTelemetryStale) {
      setStaleSeconds(0);
      return;
    }
    const computeStaleSec = () =>
      Math.max(1, Math.floor((Date.now() - lastTelemetryAtRef.current) / 1000));
    setStaleSeconds(computeStaleSec());
    const ticker = setInterval(() => setStaleSeconds(computeStaleSec()), 1000);
    return () => clearInterval(ticker);
  }, [isTelemetryStale]);

  const handleUpdateTargetUrl = async (url: string) => {
    const res = await fetch(`${import.meta.env.BASE_URL}api/v1/system`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUrl: url }),
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody?.error) msg = errBody.error;
      } catch {}
      throw new Error(msg);
    }
    await fetchLiveAndSystem();
  };

  const handleRefreshConfig = async () => {
    await fetchLiveAndSystem();
  };

  return (
    <div className="min-h-screen bg-[#111318] text-[#e6e8ee] flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-[#2563eb] focus:text-white focus:text-xs focus:font-semibold"
      >
        Skip to main content
      </a>

      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenConnectivity={() => {
          setControlsSubTab('connectivity');
          setActiveTab('controls');
        }}
        systemStats={systemStats}
      />

      <main id="main-content" tabIndex={-1} className="flex-1 pb-10 focus:outline-none">
        {activeTab === 'monitor' && (
          <ConsoleView
            telemetry={telemetry}
            telemetryStale={isTelemetryStale}
            staleSeconds={staleSeconds}
            tempUnit={tempUnit}
            setTempUnit={handleSetTempUnit}
            onOpenConnectivity={() => {
              setControlsSubTab('connectivity');
              setActiveTab('controls');
            }}
          />
        )}

        {activeTab === 'controls' && (
          <SettingsView
            activeTab={controlsSubTab}
            onTabChange={setControlsSubTab}
            onRefreshConfig={handleRefreshConfig}
            onUpdateTargetUrl={handleUpdateTargetUrl}
            isStreamConnected={isStreamConnected}
            telemetry={telemetry}
            systemStats={systemStats}
          />
        )}

        {activeTab === 'system' && <LogsView systemStats={systemStats} />}
      </main>

      <footer className="border-t border-white/[0.08] bg-[#14171d] px-4 sm:px-6 py-4 text-xs text-[#8f96a6] flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
        <div className="flex items-center gap-2">
          <span
            className="font-medium text-[#cbd5e1]"
            title="PiGradient Local Telemetry Gateway & Archiver"
          >
            PiGradient
          </span>
          <span aria-hidden="true">·</span>
          <span title="Runs locally on your Raspberry Pi LAN">AirGradient ONE Local Gateway</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 font-mono text-[11px] text-[#7e8596]">
          <span title="All sensor polls and configuration stay inside your local network">
            Local LAN
          </span>
          <span aria-hidden="true">·</span>
          <span title="Monthly partitioned SQLite database using Write-Ahead Logging">
            Monthly SQLite WAL
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => setShowA11yModal(true)}
            title="Configure High Contrast, Large Text, Reduce Motion, and Colorblind-Safe chart patterns"
            className="inline-flex items-center gap-1.5 font-sans text-xs text-[#93c5fd] hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-[#60a5fa] rounded px-1.5 py-1 cursor-pointer"
          >
            <Accessibility className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Accessibility</span>
            {activeA11yCount > 0 && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"
                aria-label={`${activeA11yCount} accessibility options enabled`}
              />
            )}
          </button>
        </div>
      </footer>

      <AccessibilityDialog
        open={showA11yModal}
        onClose={() => setShowA11yModal(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <AccessibilityProvider>
      <AppShell />
    </AccessibilityProvider>
  );
}
