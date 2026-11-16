import React, { useEffect, useState } from 'react';
import { HelpCircle, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import { MatButton, MatDialog, MatDivider, MatTabs, MatTabItem } from './material/MaterialUI';

export type SignalTabId = 'pm25_aqi' | 'co2' | 'climate' | 'humidity' | 'voc_nox' | 'analytics';

const REFERENCE_TABS: MatTabItem[] = [
  { id: 'pm25_aqi', label: 'PM2.5 & AQI', title: 'Fine particulate matter and US EPA AQI' },
  { id: 'co2', label: 'CO₂', title: 'Carbon dioxide ventilation benchmarks' },
  { id: 'climate', label: 'Climate', title: 'Temperature, Dew Point & NWS Heat Index' },
  { id: 'humidity', label: 'Humidity', title: 'Relative Humidity & Absolute Humidity' },
  { id: 'voc_nox', label: 'VOC & NOx', title: 'Sensirion SGP41 adaptive gas indices' },
  { id: 'analytics', label: 'Analytics', title: 'Moving averages, stats & thresholds' },
];

interface SignalReferenceDialogProps {
  open: boolean;
  onClose: () => void;
  tempUnit: 'f' | 'c';
  initialTab?: SignalTabId;
}

const ExamplePair: React.FC<{ good: string; bad: string }> = ({ good, bad }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
    <div className="p-3 rounded-lg bg-emerald-500/[0.07] border border-emerald-500/25 space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Good Example</span>
      </div>
      <p className="text-xs text-[#cbd5e1] leading-relaxed">{good}</p>
    </div>
    <div className="p-3 rounded-lg bg-rose-500/[0.07] border border-rose-500/25 space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Bad Example</span>
      </div>
      <p className="text-xs text-[#cbd5e1] leading-relaxed">{bad}</p>
    </div>
  </div>
);

const SourceLinks: React.FC<{ items: { label: string; href: string }[] }> = ({ items }) => (
  <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#7e8596]">
    <span>Sources:</span>
    {items.map((item) => (
      <a
        key={item.href}
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-[#93c5fd]/85 hover:text-[#bfdbfe] hover:underline focus-visible:outline-2 focus-visible:outline-[#60a5fa] rounded"
      >
        <span>{item.label}</span>
        <ExternalLink className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
      </a>
    ))}
  </div>
);

export const SignalReferenceDialog: React.FC<SignalReferenceDialogProps> = ({
  open,
  onClose,
  tempUnit,
  initialTab = 'pm25_aqi',
}) => {
  const [activeTab, setActiveTab] = useState<SignalTabId>(initialTab);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  const comfortTemp = tempUnit === 'f' ? '76 °F' : '24.4 °C';
  const comfortRange = tempUnit === 'f' ? '68–76 °F' : '20–24.4 °C';
  const heatOnset = tempUnit === 'f' ? '80 °F' : '26.7 °C';
  const dewCrisp = tempUnit === 'f' ? '55 °F' : '12.8 °C';
  const dewMuggy = tempUnit === 'f' ? '65 °F' : '18.3 °C';

  return (
    <MatDialog
      open={open}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      title="Signals, Guidelines & Limits Reference"
      subtitle="Standards behind chart thresholds, derived metrics, and live status labels"
      icon={
        <div className="w-9 h-9 rounded-lg bg-[#1e3a5f] text-[#93c5fd] flex items-center justify-center">
          <HelpCircle className="w-5 h-5" aria-hidden="true" />
        </div>
      }
      actions={
        <MatButton variant="filled" onClick={onClose}>
          Close
        </MatButton>
      }
    >
      <div className="space-y-4">
        <MatTabs
          ariaLabel="Signal reference topics"
          tabs={REFERENCE_TABS}
          value={activeTab}
          onChange={(id) => setActiveTab(id as SignalTabId)}
          dense
        />

        {activeTab === 'pm25_aqi' && (
          <div className="space-y-3 text-xs text-[#cbd5e1]">
            <p className="leading-relaxed">
              The Plantower <strong>PMS5003</strong> optical laser counter measures airborne particles
              in µg/m³ across <span className="font-mono text-lime-400">PM1.0</span> (smoke,
              vaping &amp; combustion ultrafines),{' '}
              <span className="font-mono text-emerald-400">PM2.5</span> (fine lung-penetrating), and{' '}
              <span className="font-mono text-indigo-400">PM10</span> (estimated coarse dust &amp;
              pollen; optical sensors estimate &gt;3 µm from fine scatter). PiGradient applies the{' '}
              <strong>US EPA 2021</strong> humidity-compensation curve before converting{' '}
              <span className="font-mono">PM2.5</span> into the derived{' '}
              <strong className="text-orange-400">EPA AQI</strong> (0–500).
            </p>

            <MatDivider />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                  Guideline (Dotted)
                </div>
                <div className="font-mono text-white mt-1">PM2.5 Good · 12 µg/m³</div>
                <div className="font-mono text-orange-300">EPA Good · 50 AQI</div>
                <p className="text-[#8f96a6] mt-1">Upper ceiling of the US EPA Good category.</p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                  Limit (Dashed)
                </div>
                <div className="font-mono text-white mt-1">PM2.5 USG · 35.4 µg/m³</div>
                <div className="font-mono text-orange-300">EPA USG · 100 AQI</div>
                <p className="text-[#8f96a6] mt-1">
                  Start of <em>Unhealthy for Sensitive Groups</em> (US EPA AQI breakpoints).
                </p>
              </div>
            </div>

            <div className="text-[11px] text-[#9ca3af] font-mono">
              Statuses: Good (0–50) · Moderate (51–100) · Unhealthy for Sensitive Groups (101–150) ·
              Unhealthy (151–200) · Very Unhealthy (201–300) · Hazardous (301–500)
            </div>

            <ExamplePair
              good="1–10 µg/m³ (4–42 AQI): Normal filtered indoor air with windows closed or clean outdoor breeze."
              bad="> 35.4 µg/m³ (> 100 AQI): Seared cooking smoke without hood fan, candles, or wildfire smoke infiltration."
            />

            <SourceLinks
              items={[
                { label: 'US EPA AQI Basics', href: 'https://www.airnow.gov/aqi/aqi-basics/' },
                {
                  label: 'AirGradient EPA 2021 Correction',
                  href: 'https://www.airgradient.com/documentation/pm-correction/',
                },
              ]}
            />
          </div>
        )}

        {activeTab === 'co2' && (
          <div className="space-y-3 text-xs text-[#cbd5e1]">
            <p className="leading-relaxed">
              The <strong>Senseair NDIR</strong> sensor measures indoor Carbon Dioxide in{' '}
              <span className="font-mono text-[#93c5fd]">ppm</span>. Outdoor ambient air sits near{' '}
              <span className="font-mono text-white">~420 ppm</span>; rising indoor CO₂ directly
              indicates insufficient fresh-air exchange rather than immediate toxicity.
            </p>

            <MatDivider />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-[#93c5fd] uppercase tracking-wider">
                  Guideline (Dotted)
                </div>
                <div className="font-mono text-white mt-1">CO₂ Good · 800 ppm</div>
                <p className="text-[#8f96a6] mt-1">
                  ASHRAE / REHVA well-ventilated benchmark for sharp focus and comfort.
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                  Limit (Dashed)
                </div>
                <div className="font-mono text-white mt-1">CO₂ Limit · 1000 ppm</div>
                <p className="text-[#8f96a6] mt-1">
                  ASHRAE / Pettenkofer ventilation limit where stuffiness and fatigue begin.
                </p>
              </div>
            </div>

            <div className="text-[11px] text-[#9ca3af] font-mono">
              Statuses: Good (&lt;800) · Moderate (800–999) · Elevated (1000–1399) · High (≥1400)
            </div>

            <ExamplePair
              good="450–750 ppm: Bedroom or office with active HVAC fresh-air intake or a cracked window."
              bad="> 1,400 ppm: Closed bedroom overnight or crowded meeting room—crack a window to flush CO₂."
            />

            <SourceLinks
              items={[
                {
                  label: 'ASHRAE Standard 62.1',
                  href: 'https://www.ashrae.org/technical-resources/bookstore/standards-62-1-and-62-2',
                },
                {
                  label: 'Harvard COGfx CO₂ Study',
                  href: 'https://ehp.niehs.nih.gov/doi/10.1289/ehp.1510037',
                },
              ]}
            />
          </div>
        )}

        {activeTab === 'climate' && (
          <div className="space-y-3 text-xs text-[#cbd5e1]">
            <p className="leading-relaxed">
              Measures heat-compensated <strong>Temperature</strong> alongside two derived metrics:{' '}
              <strong className="text-sky-400">Dew Point</strong> (Magnus formula temperature where
              vapor condenses into liquid) and{' '}
              <strong className="text-rose-400">NWS Heat Index</strong> (Rothfusz apparent felt
              temperature combining heat + humidity when ≥ {heatOnset}).
            </p>

            <MatDivider />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                  Guideline (Dotted)
                </div>
                <div className="font-mono text-white mt-1">ASHRAE Max · {comfortTemp}</div>
                <p className="text-[#8f96a6] mt-1">
                  ASHRAE Standard 55 upper indoor thermal comfort zone ({comfortRange}).
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-rose-400 uppercase tracking-wider">
                  Limit (Dashed)
                </div>
                <div className="font-mono text-white mt-1">NWS Heat · {heatOnset}</div>
                <p className="text-[#8f96a6] mt-1">
                  Exact NOAA National Weather Service threshold where Heat Index effects begin.
                </p>
              </div>
            </div>

            <ExamplePair
              good={`Temp ${comfortRange} with Dew Point ≤ ${dewCrisp}: Dry, effortless thermal comfort.`}
              bad={`Heat Index > ${heatOnset} or Dew Point > ${dewMuggy}: Muggy heat stress and cold-glass condensation risk.`}
            />

            <SourceLinks
              items={[
                {
                  label: 'ASHRAE Standard 55',
                  href: 'https://www.ashrae.org/technical-resources/bookstore/standard-55-thermal-environmental-conditions-for-human-occupancy',
                },
                {
                  label: 'NOAA NWS Heat Index Chart',
                  href: 'https://www.weather.gov/ama/heatindex',
                },
              ]}
            />
          </div>
        )}

        {activeTab === 'humidity' && (
          <div className="space-y-3 text-xs text-[#cbd5e1]">
            <p className="leading-relaxed">
              Tracks compensated <strong>Relative Humidity (% RH)</strong> and derived{' '}
              <strong className="text-teal-400">Absolute Humidity (g/m³)</strong> (actual water
              vapor mass per cubic meter via the Bolton/WMO equation, independent of temperature
              swings).
            </p>

            <MatDivider />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider">
                  Guideline (Dotted)
                </div>
                <div className="font-mono text-white mt-1">RH Min · 30%</div>
                <p className="text-[#8f96a6] mt-1">
                  US EPA lower indoor bound to prevent dry airways and static. (30–60% is a safe
                  band rather than one single point.)
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                  Limit (Dashed)
                </div>
                <div className="font-mono text-white mt-1">RH High · 60%</div>
                <p className="text-[#8f96a6] mt-1">
                  US EPA upper indoor ceiling above which mold spores and dust mites proliferate.
                </p>
              </div>
            </div>

            <ExamplePair
              good="35–55% RH (~7–12 g/m³): Balanced indoor moisture with minimal dust mite or dry-skin issues."
              bad="< 25% RH (winter heater dryness) or > 60% RH (damp basement or post-shower steam without exhaust)."
            />

            <SourceLinks
              items={[
                {
                  label: 'US EPA Mold & Moisture Guide',
                  href: 'https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home',
                },
              ]}
            />
          </div>
        )}

        {activeTab === 'voc_nox' && (
          <div className="space-y-3 text-xs text-[#cbd5e1]">
            <p className="leading-relaxed">
              The <strong>Sensirion SGP41</strong> reports adaptive <strong>1–500 Gas Indices</strong>{' '}
              measured relative to a rolling <strong>24-hour room baseline</strong> (not raw ppb).
              Values below baseline mean the room is currently cleaner than its 24h average.
            </p>

            <MatDivider />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider">
                  Guideline (Dotted)
                </div>
                <div className="font-mono text-white mt-1">TVOC Baseline · 100</div>
                <p className="text-[#8f96a6] mt-1">
                  SGP41 learned clean-air reference (100 for TVOC, 1 for NOx).
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="text-[11px] font-semibold text-pink-400 uppercase tracking-wider">
                  Limit (Dashed)
                </div>
                <div className="font-mono text-white mt-1">TVOC Limit · 250 / NOx · 20</div>
                <p className="text-[#8f96a6] mt-1">
                  Significant chemical off-gassing (TVOC ≥250) or combustion exhaust (NOx ≥20).
                </p>
              </div>
            </div>

            <div className="text-[11px] text-[#9ca3af] font-mono">
              Statuses: Normal (TVOC &lt;150, NOx &lt;5) · Moderate (≥150 / ≥5) · Elevated (≥250 /
              ≥20) · High (≥400 / ≥100)
            </div>

            <ExamplePair
              good="TVOC 80–120, NOx 1: Settled indoor room air after ventilation."
              bad="TVOC > 250 or NOx > 20: Aerosol sprays, solvents, fresh paint, candles, or unvented gas cooking."
            />

            <SourceLinks
              items={[
                {
                  label: 'Sensirion SGP41 Gas Index',
                  href: 'https://sensirion.com/products/catalog/SGP41',
                },
                {
                  label: 'AirGradient TVOC & NOx Guide',
                  href: 'https://www.airgradient.com/documentation/tvoc-nox-explaination/',
                },
              ]}
            />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="space-y-3 text-xs text-[#cbd5e1]">
            <p className="leading-relaxed">
              Analytical overlays run live in your browser on the active window without modifying
              your archived SQLite data.
            </p>

            <MatDivider />

            <div className="space-y-2.5">
              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="font-semibold text-white">Guidelines vs. Limits (Non-Forcing)</div>
                <p className="text-[#8f96a6] mt-0.5 leading-relaxed">
                  <strong>Guidelines</strong> (dotted lines) mark clean/comfort reference levels.{' '}
                  <strong>Limits</strong> (darker dashed lines) mark exposure or ventilation action
                  thresholds. Lines only appear when their value falls within the active Y-axis
                  range so your data scale is never stretched.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="font-semibold text-white">
                  Moving Avg &amp; Rolling Avg Only
                </div>
                <p className="text-[#8f96a6] mt-0.5 leading-relaxed">
                  Computes a trailing simple moving average across 5, 15, or 30 samples, labeled in
                  real duration (<span className="font-mono text-[#cbd5e1]">5s / 15s / 30s</span>{' '}
                  at 1s live resolution). Enable <strong>Rolling Avg Only</strong> to hide raw
                  per-second noise and view smoothed curves + stats exclusively.
                </p>
              </div>

              <div className="p-2.5 rounded-lg bg-[#161920] border border-white/[0.08]">
                <div className="font-semibold text-white">Window Statistics Table</div>
                <p className="text-[#8f96a6] mt-0.5 leading-relaxed font-mono text-[11px]">
                  Min (lowest) · Avg (mean) · Max (peak) · σ (std deviation / volatility) · Δ Net
                  (end − start)
                </p>
              </div>
            </div>

            <SourceLinks
              items={[
                {
                  label: 'NIST Statistics Handbook (Mean & Std Dev)',
                  href: 'https://www.itl.nist.gov/div898/handbook/eda/section3/eda356.htm',
                },
              ]}
            />
          </div>
        )}
      </div>
    </MatDialog>
  );
};
