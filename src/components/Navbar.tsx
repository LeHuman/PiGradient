import React from 'react';
import { Activity, Sliders, Server, Wifi } from 'lucide-react';
import { SystemStats } from '../types/telemetry';
import { MatTabs, MatTabItem } from './material/MaterialUI';

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

  const statusTextClass = isUnconfigured
    ? 'text-amber-400'
    : systemStats?.collectorStatus === 'online'
    ? 'text-emerald-400'
    : systemStats?.collectorStatus === 'degraded'
    ? 'text-amber-400'
    : 'text-rose-400';

  const statusLabel = isUnconfigured
    ? 'Not Configured'
    : systemStats?.collectorStatus === 'degraded'
    ? 'Degraded'
    : systemStats?.collectorStatus === 'offline'
    ? 'Offline'
    : 'Online';

  const statusTooltip = !systemStats
    ? 'Connecting to collector status...'
    : isUnconfigured
    ? 'No monitor LAN URL configured yet'
    : `Collector ${statusLabel}: ${systemStats.targetDeviceUrl} · ${systemStats.latencyMs}ms RTT · Poll every ${systemStats.pollIntervalSec}s`;

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
          onClick={onOpenConnectivity}
          aria-label={`Collector ${statusLabel}. Open Connectivity settings`}
          title={`${statusTooltip} — Click to open Connectivity settings`}
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
