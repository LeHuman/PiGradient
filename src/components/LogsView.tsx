import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  Download,
  HardDrive,
  Cpu,
  Clock,
  Activity,
} from 'lucide-react';
import { LogEntry, SystemStats } from '../types/telemetry';
import {
  MatButton,
  MatCard,
  MatDivider,
  MatSegmentedButton,
  MatTextField,
} from './material/MaterialUI';

interface LogsViewProps {
  systemStats: SystemStats | null;
}

const LEVEL_OPTIONS = [
  { id: 'ALL', label: 'All', title: 'Show all daemon log levels' },
  { id: 'INFO', label: 'Info', title: 'Routine operational events' },
  { id: 'WARN', label: 'Warn', title: 'Recoverable warnings and backoff transitions' },
  { id: 'ERROR', label: 'Error', title: 'Critical connection or storage failures' },
];

export const LogsView: React.FC<LogsViewProps> = ({ systemStats }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const terminalRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/v1/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(Array.isArray(data) ? data : []);
      }
    } catch {
      // Transient polling error handled cleanly on next interval
    }
  };

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((l) => {
    if (filterLevel !== 'ALL' && l.level !== filterLevel) return false;
    if (
      searchTerm &&
      !l.message.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !l.component.toLowerCase().includes(searchTerm.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  const formatUptime = (sec: number) => {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  const downloadLogs = () => {
    const text = logs
      .map(
        (l) =>
          `[${new Date(l.timestamp * 1000).toISOString()}] [${l.level}] [${l.component}] ${
            l.message
          }`
      )
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pigradient-logs-${new Date().toISOString().split('T')[0]}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const collectorLabel =
    systemStats?.collectorStatus === 'degraded'
      ? 'Degraded'
      : systemStats?.collectorStatus === 'offline'
      ? 'Offline'
      : 'Online';

  return (
    <div className="space-y-4 sm:space-y-5 max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5">
      {/* System Diagnostics Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <MatCard
          className="p-3.5 sm:p-4 flex flex-col justify-between"
          title={`Polls ${systemStats?.targetDeviceUrl || 'monitor'} every ${systemStats?.pollIntervalSec ?? 1}s; automatically backs off to 5s or 15s on consecutive errors`}
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] mb-1.5">
              <Activity className="w-3.5 h-3.5 text-[#60a5fa] shrink-0" aria-hidden="true" />
              <span className="truncate">Polling Cadence</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-white tabular-nums">
              {systemStats?.pollIntervalSec ?? 1}.0s
            </div>
          </div>
          <div>
            <MatDivider className="my-2" />
            <div className="text-[11px] sm:text-xs text-[#8f96a6] flex items-center justify-between gap-1 font-mono tabular-nums">
              <span title="HTTP roundtrip latency to AirGradient /measures/current">
                {systemStats?.latencyMs ?? 0}ms RTT
              </span>
              <span
                title={`Collector state: ${collectorLabel}`}
                className={
                  systemStats?.collectorStatus === 'online'
                    ? 'text-emerald-400'
                    : systemStats?.collectorStatus === 'degraded'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }
              >
                {collectorLabel}
              </span>
            </div>
          </div>
        </MatCard>

        <MatCard
          className="p-3.5 sm:p-4 flex flex-col justify-between"
          title="Current monthly SQLite database file using Write-Ahead Logging (WAL) for crash-safe concurrent writes"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] mb-1.5">
              <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
              <span className="truncate">SQLite Archive</span>
            </div>
            <div className="text-sm sm:text-base font-bold font-mono text-emerald-400 truncate">
              {systemStats?.activePartition || 'Initializing...'}
            </div>
          </div>
          <div>
            <MatDivider className="my-2" />
            <div
              className="text-[11px] sm:text-xs text-[#8f96a6] font-mono tabular-nums truncate"
              title="Total stored rows across active monthly partitions (~72 bytes per row)"
            >
              {(systemStats?.totalRecordsRecorded ?? 0).toLocaleString()} rows · WAL
            </div>
          </div>
        </MatCard>

        <MatCard
          className="p-3.5 sm:p-4 flex flex-col justify-between"
          title="Resident process memory and active concurrency goroutines/workers"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] mb-1.5">
              <Cpu className="w-3.5 h-3.5 text-indigo-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Daemon Memory</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-white tabular-nums">
              {systemStats?.memoryMb ?? 0} MB
            </div>
          </div>
          <div>
            <MatDivider className="my-2" />
            <div className="text-[11px] sm:text-xs text-[#8f96a6] font-mono tabular-nums truncate">
              {systemStats?.goroutines ?? 0} goroutines
            </div>
          </div>
        </MatCard>

        <MatCard
          className="p-3.5 sm:p-4 flex flex-col justify-between"
          title="Continuous uptime since the PiGradient gateway process started"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs text-[#9ca3af] mb-1.5">
              <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="truncate">Daemon Uptime</span>
            </div>
            <div className="text-lg sm:text-xl font-bold font-mono text-white tabular-nums truncate">
              {formatUptime(systemStats?.uptimeSeconds ?? 0)}
            </div>
          </div>
          <div>
            <MatDivider className="my-2" />
            <div
              className="text-[11px] sm:text-xs text-[#8f96a6] font-mono tabular-nums truncate"
              title="Consecutive failed HTTP polls before monitor recovery"
            >
              Failures: {systemStats?.consecutiveFailures ?? 0}
            </div>
          </div>
        </MatCard>
      </div>

      {/* Live Daemon Log Stream */}
      <MatCard className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div className="flex items-center justify-between gap-2">
            <div
              className="flex items-center gap-2 min-w-0 cursor-help"
              title="Live gateway daemon event log stream"
            >
              <Terminal
                className="w-4 h-4 text-[#60a5fa] shrink-0"
                aria-hidden="true"
              />
              <h2 className="text-sm sm:text-base font-semibold text-white font-display truncate">
                Daemon Log Stream
              </h2>
            </div>
            <span
              className="text-xs text-[#8f96a6] font-mono tabular-nums shrink-0"
              title={`Showing ${filteredLogs.length} of ${logs.length} buffered events`}
            >
              {filteredLogs.length} events
            </span>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full lg:w-auto">
            <MatSegmentedButton
              ariaLabel="Log level filter"
              options={LEVEL_OPTIONS}
              value={filterLevel}
              onChange={setFilterLevel}
              fullWidthOnMobile
            />

            <div className="grid grid-cols-[1fr_auto_auto] sm:flex items-center gap-2 w-full sm:w-auto">
              <MatTextField
                label=""
                ariaLabel="Filter log messages"
                title="Filter logs by message text or subsystem component (e.g. Store, Collector, Config)"
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Filter logs..."
                mono
                className="!space-y-0 sm:w-48 [&_input]:!min-h-[38px] sm:[&_input]:!min-h-[36px] [&_input]:!py-1"
              />

              <MatButton
                variant={autoScroll ? 'tonal' : 'outlined'}
                size="sm"
                aria-pressed={autoScroll}
                title="Toggle automatic scrolling as new log entries arrive"
                onClick={() => setAutoScroll(!autoScroll)}
                className="!min-h-[38px] sm:!min-h-[36px]"
              >
                <span className="sm:hidden">Scroll: {autoScroll ? 'On' : 'Off'}</span>
                <span className="hidden sm:inline">
                  Auto-Scroll: {autoScroll ? 'On' : 'Off'}
                </span>
              </MatButton>

              <MatButton
                variant="outlined"
                size="sm"
                onClick={downloadLogs}
                title="Download buffered daemon log entries as a .log file"
                className="!min-h-[38px] sm:!min-h-[36px]"
                icon={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                <span className="hidden sm:inline">Export</span>
              </MatButton>
            </div>
          </div>
        </div>

        {/* Log Output Viewport */}
        <div
          ref={terminalRef}
          role="log"
          aria-live="off"
          aria-label="Daemon log output"
          className="h-[340px] sm:h-[440px] bg-[#0f1116] rounded-lg p-3 sm:p-4 font-mono text-xs overflow-y-auto space-y-2 sm:space-y-1.5 border border-white/[0.08]"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-[#667085] text-center py-20">
              No matching log entries found.
            </div>
          ) : (
            filteredLogs.map((entry) => {
              const timeStr = new Date(entry.timestamp * 1000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });

              const levelColor =
                entry.level === 'ERROR'
                  ? 'text-rose-400'
                  : entry.level === 'WARN'
                  ? 'text-amber-400'
                  : 'text-[#60a5fa]';

              return (
                <div
                  key={entry.id}
                  className="flex flex-col sm:flex-row sm:items-start gap-0.5 sm:gap-2.5 leading-relaxed hover:bg-white/[0.03] px-1.5 py-1 sm:py-0.5 rounded"
                >
                  <div className="flex items-center gap-2 shrink-0 text-[11px] sm:text-xs">
                    <span className="text-[#667085] select-none tabular-nums">
                      {timeStr}
                    </span>
                    <span className={`font-semibold w-10 ${levelColor}`}>
                      {entry.level}
                    </span>
                    <span className="text-[#9ca3af] font-medium">
                      [{entry.component}]
                    </span>
                  </div>
                  <span className="text-[#e6e8ee] break-words sm:break-all">
                    {entry.message}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </MatCard>
    </div>
  );
};
