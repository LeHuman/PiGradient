// Client-side environmental analytics matching server/analytics/aqi.go & environment.go

const PM25_BREAKPOINTS = [
  { cLow: 0.0, cHigh: 12.0, iLow: 0, iHigh: 50 },
  { cLow: 12.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
  { cLow: 55.5, cHigh: 150.4, iLow: 151, iHigh: 200 },
  { cLow: 150.5, cHigh: 250.4, iLow: 201, iHigh: 300 },
  { cLow: 250.5, cHigh: 500.4, iLow: 301, iHigh: 500 },
];

export function calculatePm25Aqi(pm25: number): number {
  const c = Math.round(pm25 * 10) / 10;
  for (const bp of PM25_BREAKPOINTS) {
    if (c >= bp.cLow && c <= bp.cHigh) {
      return Math.round(((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (c - bp.cLow) + bp.iLow);
    }
  }
  if (c > 500.4) return 500;
  return 0;
}

export function calculateDewPointC(tempC: number, rh: number): number {
  if (rh <= 0) return 0;
  const clampedRh = Math.min(100, rh);
  const a = 17.27;
  const b = 237.7;
  const alpha = (a * tempC) / (b + tempC) + Math.log(clampedRh / 100.0);
  if (Math.abs(a - alpha) < 1e-6) return Math.round(tempC * 10) / 10;
  const dp = (b * alpha) / (a - alpha);
  if (!Number.isFinite(dp)) return 0;
  return Math.round(dp * 10) / 10;
}

export function calculateHeatIndexC(tempC: number, rh: number): number {
  const tF = (tempC * 9.0) / 5.0 + 32.0;
  if (tF < 80.0) return Math.round(tempC * 10) / 10;
  const hiF =
    -42.379 +
    2.04901523 * tF +
    10.14333127 * rh -
    0.22475541 * tF * rh -
    0.00683783 * tF * tF -
    0.05481717 * rh * rh +
    0.00122874 * tF * tF * rh +
    0.00085282 * tF * rh * rh -
    0.00000199 * tF * tF * rh * rh;
  return Math.round((((hiF - 32.0) * 5.0) / 9.0) * 10) / 10;
}

// Bolton/WMO absolute humidity in g/m³
export function calculateAbsoluteHumidity(tempC: number, rh: number): number {
  if (rh <= 0) return 0;
  const clampedRh = Math.min(100, rh);
  const es = 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
  const ah = (es * clampedRh * 2.1674) / (273.15 + tempC);
  if (!Number.isFinite(ah)) return 0;
  return Math.round(ah * 10) / 10;
}

export function cToF(tempC: number): number {
  return Math.round(((tempC * 9) / 5 + 32) * 10) / 10;
}

// Sensirion ethanol-equivalent TVOC (ppb) estimate derived from SGP41 TVOC Gas Index
export function calculateTvocPpb(tvocIndex: number): number | null {
  if (!Number.isFinite(tvocIndex) || tvocIndex <= 0 || tvocIndex >= 501) {
    return null;
  }
  const ppb = -381.97 * (Math.log(501 - tvocIndex) - 6.24);
  if (!Number.isFinite(ppb)) return null;
  return Math.round(ppb * 10) / 10;
}

export function computeRollingAverage(
  values: (number | null)[],
  windowSize: number
): (number | null)[] {
  if (windowSize <= 1 || values.length === 0) return values;
  const result: (number | null)[] = new Array(values.length);
  let runningSum = 0;
  let validCount = 0;
  for (let i = 0; i < values.length; i++) {
    const enter = values[i];
    if (enter !== null && Number.isFinite(enter)) {
      runningSum += enter;
      validCount += 1;
    }
    if (i >= windowSize) {
      const leave = values[i - windowSize];
      if (leave !== null && Number.isFinite(leave)) {
        runningSum -= leave;
        validCount -= 1;
      }
    }
    if (enter === null || !Number.isFinite(enter) || validCount === 0) {
      result[i] = null;
    } else {
      result[i] = Math.round((runningSum / validCount) * 10) / 10;
    }
  }
  return result;
}

export interface SeriesStatsSummary {
  min: number;
  avg: number;
  max: number;
  stdDev: number;
  delta: number;
}

export function computeSeriesStats(values: (number | null)[]): SeriesStatsSummary | null {
  let validCount = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let firstValid = 0;
  let lastValid = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    if (validCount === 0) firstValid = v;
    lastValid = v;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    validCount += 1;
  }

  if (validCount === 0) return null;
  const avg = sum / validCount;
  let sqDiff = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) continue;
    const d = v - avg;
    sqDiff += d * d;
  }
  const stdDev = Math.sqrt(sqDiff / validCount);
  const delta = lastValid - firstValid;

  const round1 = (n: number) => Math.round(n * 10) / 10;
  return {
    min: round1(min),
    avg: round1(avg),
    max: round1(max),
    stdDev: round1(stdDev),
    delta: round1(delta),
  };
}
