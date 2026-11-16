import React from 'react';
import { Activity, Sliders, Server, Wifi } from 'lucide-react';
import { SystemStats } from '../types/telemetry';
import { MatTabs, MatTabItem } from './material/MaterialUI';

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
};

// Human-readable archive storage detail for the status tooltip (empty when OK)
const describeStorageStatus = (stats: SystemStats): string => {
  if (!stats.storageStatus || stats.storageStatus === 'ok') return '';
  const details: string[] = [`Storage ${stats.storageStatus}`];
  if (stats.lastWriteError) details.push(stats.lastWriteError);
  if (typeof stats.droppedRecords === 'number' && stats.droppedRecords > 0) {
    details.push(`${stats.droppedRecords} records dropped`);
  }
  if (typeof stats.diskFreeBytes === 'number' && stats.diskFreeBytes > 0) {
    details.push(`${formatBytes(stats.diskFreeBytes)} disk free`);
  }
  return ` · ${details.join(' · ')}`;
};

interface NavbarProps {
  activeTab: 'monitor' | 'controls' | 'system';
  setActiveTab: (tab: 'monitor' | 'controls' | 'system') => void;
  onOpenConnectivity: () => void;
  systemStats: SystemStats | null;
}

const DESKTOP_TABS: MatTabItem[] = [
  {
    id: 'monitor',
    label: 'Monitor & Trends',
    icon: <Activity className="w-4 h-4" />,
    title: 'Live sensor dashboard, rolling averages, and historical telemetry graphs',
  },
  {
    id: 'controls',
    label: 'Device Controls',
    icon: <Sliders className="w-4 h-4" />,
    title: 'AirGradient NVS hardware configuration, OLED/LED schedules, and LAN connectivity',
  },
  {
    id: 'system',
    label: 'System & Diagnostics',
    icon: <Server className="w-4 h-4" />,
    title: 'Collector metrics, SQLite partition health, and live daemon logs',
  },
];

const MOBILE_TABS: MatTabItem[] = [
  {
    id: 'monitor',
    label: 'Monitor',
    icon: <Activity className="w-3.5 h-3.5" />,
    title: 'Live telemetry & trends',
  },
  {
    id: 'controls',
    label: 'Controls',
    icon: <Sliders className="w-3.5 h-3.5" />,
    title: 'Device hardware & network settings',
  },
  {
    id: 'system',
    label: 'System',
    icon: <Server className="w-3.5 h-3.5" />,
    title: 'System diagnostics & daemon logs',
  },
];

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  onOpenConnectivity,
  systemStats,
}) => {
  const isUnconfigured = Boolean(systemStats && !systemStats.targetDeviceUrl);
  const isStorageError = systemStats?.storageStatus === 'error';
  const isStorageDegraded = systemStats?.storageStatus === 'degraded';
  const isCollectorOffline = systemStats?.collectorStatus === 'offline';
  const isCollectorDegraded = systemStats?.collectorStatus === 'degraded';

  // Worst-of badge: storage error or device offline → red, degraded states → amber
  const hasErrorState = isStorageError || isCollectorOffline;
  const hasWarningState =
    !hasErrorState && (isStorageDegraded || isCollectorDegraded || isUnconfigured);

  const statusTextClass = !systemStats
    ? 'text-rose-400'
    : hasErrorState
    ? 'text-rose-400'
    : hasWarningState
    ? 'text-amber-400'
    : 'text-emerald-400';

  const statusLabel = isStorageError
    ? 'Storage Error'
    : isCollectorOffline
    ? 'Offline'
    : isStorageDegraded
    ? 'Storage Degraded'
    : isCollectorDegraded
    ? 'Degraded'
    : isUnconfigured
    ? 'Not Configured'
    : 'Online';

  const statusTooltip = !systemStats
    ? 'Connecting to collector status...'
    : isUnconfigured
    ? 'No monitor LAN URL configured yet'
    : `Collector ${statusLabel}: ${systemStats.targetDeviceUrl} · ${systemStats.latencyMs}ms RTT · Poll every ${systemStats.pollIntervalSec}s${describeStorageStatus(systemStats)}`;

  // Route storage-driven states to System & Diagnostics; collector states keep
  // the existing Connectivity settings navigation
  const openDiagnostics = isStorageError || (isStorageDegraded && !hasErrorState);

  return (
    <header className="sticky top-0 z-30 bg-[#161920]/95 backdrop-blur-md border-b border-white/[0.09]">
      {/* Material Top App Bar: 3 Zones */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-12 md:h-14 flex items-center justify-between gap-3 md:gap-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => setActiveTab('monitor')}
          title="PiGradient — Return to Monitor & Trends view"
          className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#60a5fa] rounded-lg py-1 cursor-pointer"
        >
          <div className="w-7 h-7 rounded-lg bg-[#2563eb] flex items-center justify-center text-white shrink-0">
            <Activity className="w-4 h-4" aria-hidden="true" />
          </div>
          <span className="text-[15px] sm:text-base font-bold tracking-tight text-white font-display whitespace-nowrap">
            PiGradient
          </span>
        </button>

        {/* Zone 2: Desktop Material Tabs with Ink Bar */}
        <nav aria-label="Primary navigation" className="hidden md:flex items-stretch h-full">
          <MatTabs
            tabs={DESKTOP_TABS}
            value={activeTab}
            onChange={(id) => setActiveTab(id as NavbarProps['activeTab'])}
            className="border-b-0 h-full"
          />
        </nav>

        {/* Zone 3: Connection Status Button -> Connectivity Settings */}
        <button
          type="button"
          onClick={() => (openDiagnostics ? setActiveTab('system') : onOpenConnectivity())}
          aria-label={`Collector ${statusLabel}. Open ${
            openDiagnostics ? 'System & Diagnostics' : 'Connectivity settings'
          }`}
          title={`${statusTooltip} — Click to open ${
            openDiagnostics ? 'System & Diagnostics' : 'Connectivity settings'
          }`}
          className="flex items-center gap-1.5 text-xs shrink-0 px-2 py-1.5 -mr-2 rounded-lg hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[#60a5fa] transition-colors cursor-pointer"
        >
          <Wifi className={`w-3.5 h-3.5 ${statusTextClass}`} aria-hidden="true" />
          <span className={`font-medium ${statusTextClass}`}>{statusLabel}</span>
        </button>
      </div>

      {/* Mobile Compact Material Tab Strip */}
      <nav aria-label="Mobile navigation" className="md:hidden border-t border-white/[0.06]">
        <MatTabs
          tabs={MOBILE_TABS}
          value={activeTab}
          onChange={(id) => setActiveTab(id as NavbarProps['activeTab'])}
          fullWidth
          dense
          className="border-b-0"
        />
      </nav>
    </header>
  );
};
