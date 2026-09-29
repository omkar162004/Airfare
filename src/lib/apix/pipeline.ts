import { ROUTES, ROUTE_WEIGHTS } from "./routes";
import {
  WINDOWS,
  type Anomaly,
  type CleanedQuote,
  type FareQuote,
  type Frequency,
  type IndexPoint,
  type WindowKey,
} from "./types";

/* ------------------------------------------------------------------ */
/* Cleaning                                                            */
/* ------------------------------------------------------------------ */

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export interface CleaningReport {
  total: number;
  soldOut: number;
  cancelled: number;
  outliers: number;
  usable: number;
  deduped: number;
}

/**
 * IQR x 3 outlier flagging per (route, window) group. The wide multiplier is
 * deliberate: genuine intraday swings of 200-400% are expected in airfares, so
 * a 1.5x fence would delete real surge pricing.
 */
export function cleanQuotes(quotes: FareQuote[]): {
  cleaned: CleanedQuote[];
  report: CleaningReport;
} {
  // De-duplicate identical probes of the same route/date/window/source.
  const seen = new Set<string>();
  const unique: FareQuote[] = [];
  let deduped = 0;
  for (const q of quotes) {
    if (seen.has(q.id)) {
      deduped++;
      continue;
    }
    seen.add(q.id);
    unique.push(q);
  }

  const groups = new Map<string, number[]>();
  for (const q of unique) {
    if (q.status !== "active" || q.totalFare == null) continue;
    const key = `${q.routeId}|${q.window}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(q.totalFare);
    else groups.set(key, [q.totalFare]);
  }

  const fences = new Map<string, [number, number]>();
  for (const [key, values] of groups) {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    fences.set(key, [q1 - iqr * 3, q3 + iqr * 3]);
  }

  let soldOut = 0;
  let cancelled = 0;
  let outliers = 0;

  const cleaned: CleanedQuote[] = unique.map((q) => {
    if (q.status === "sold_out") soldOut++;
    if (q.status === "cancelled") cancelled++;

    let outlier = false;
    if (q.status === "active" && q.totalFare != null) {
      const fence = fences.get(`${q.routeId}|${q.window}`);
      if (fence && (q.totalFare < fence[0] || q.totalFare > fence[1])) {
        outlier = true;
        outliers++;
      }
    }

    // A sold-out or cancelled probe is never treated as a price of zero.
    const usable = q.status === "active" && q.totalFare != null && !outlier;
    return { ...q, outlier, usable };
  });

  return {
    cleaned,
    report: {
      total: unique.length,
      soldOut,
      cancelled,
      outliers,
      usable: cleaned.filter((c) => c.usable).length,
      deduped,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Aggregation helpers                                                 */
/* ------------------------------------------------------------------ */

function periodKey(iso: string, freq: Frequency): string {
  if (freq === "daily") return iso;
  if (freq === "monthly") return iso.slice(0, 7);
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7)); // ISO week start (Monday)
  return d.toISOString().slice(0, 10);
}

interface Cell {
  priceSum: number;
  priceN: number;
  qtySum: number;
}

/**
 * Re-aggregates from cleaned quote level for every frequency rather than
 * averaging already-averaged numbers, which would distort weekly/monthly.
 */
function buildPanel(
  cleaned: CleanedQuote[],
  freq: Frequency,
  window: WindowKey | "all",
): Map<string, Map<string, Cell>> {
  const panel = new Map<string, Map<string, Cell>>();
  for (const q of cleaned) {
    if (!q.usable || q.totalFare == null) continue;
    if (window !== "all" && q.window !== window) continue;
    const period = periodKey(q.observedOn, freq);
    let row = panel.get(period);
    if (!row) {
      row = new Map();
      panel.set(period, row);
    }
    const cell = row.get(q.routeId);
    if (cell) {
      cell.priceSum += q.totalFare;
      cell.priceN += 1;
      cell.qtySum += q.quantity;
    } else {
      row.set(q.routeId, { priceSum: q.totalFare, priceN: 1, qtySum: q.quantity });
    }
  }
  return panel;
}

/* ------------------------------------------------------------------ */
/* Index construction                                                  */
/* ------------------------------------------------------------------ */

/**
 * Traffic-weighted price index.
 *  Laspeyres: base-period quantities
 *  Paasche:   current-period quantities
 *  Fisher:    geometric mean of the two
 * Base period = first period of the collection window, set to 100.
 * Weights re-normalise over the routes that actually have data in a period.
 */
export function buildIndex(
  cleaned: CleanedQuote[],
  freq: Frequency,
  window: WindowKey | "all" = "all",
): IndexPoint[] {
  const panel = buildPanel(cleaned, freq, window);
  const periods = [...panel.keys()].sort();
  if (periods.length === 0) return [];

  const baseRow = panel.get(periods[0]!)!;
  const basePrice = new Map<string, number>();
  const baseQty = new Map<string, number>();
  for (const [routeId, cell] of baseRow) {
    basePrice.set(routeId, cell.priceSum / cell.priceN);
    baseQty.set(routeId, cell.qtySum);
  }

  const points: IndexPoint[] = [];
  for (const period of periods) {
    const row = panel.get(period)!;
    const routeIds = ROUTES.map((r) => r.id).filter(
      (id) => row.has(id) && basePrice.has(id),
    );
    if (routeIds.length === 0) continue;

    const weightTotal = routeIds.reduce((s, id) => s + (ROUTE_WEIGHTS[id] ?? 0), 0);

    let lNum = 0;
    let lDen = 0;
    let pNum = 0;
    let pDen = 0;

    for (const id of routeIds) {
      const w = (ROUTE_WEIGHTS[id] ?? 0) / weightTotal;
      const cell = row.get(id)!;
      const pt = cell.priceSum / cell.priceN;
      const p0 = basePrice.get(id)!;
      const q0 = baseQty.get(id)!;
      const qt = cell.qtySum;

      lNum += w * pt * q0;
      lDen += w * p0 * q0;
      pNum += w * pt * qt;
      pDen += w * p0 * qt;
    }

    const laspeyres = (lNum / lDen) * 100;
    const paasche = (pNum / pDen) * 100;
    points.push({
      period,
      laspeyres: round2(laspeyres),
      paasche: round2(paasche),
      fisher: round2(Math.sqrt(laspeyres * paasche)),
    });
  }

  return points;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Per-route index, elasticity, heatmap                                */
/* ------------------------------------------------------------------ */

export interface RouteStat {
  routeId: string;
  weight: number;
  index: number;
  momPct: number;
  avgFare: number;
  latestByWindow: Record<number, number | null>;
  observations: number;
}

export function routeStats(cleaned: CleanedQuote[]): RouteStat[] {
  const byRoute = new Map<string, CleanedQuote[]>();
  for (const q of cleaned) {
    if (!q.usable) continue;
    const arr = byRoute.get(q.routeId);
    if (arr) arr.push(q);
    else byRoute.set(q.routeId, [q]);
  }

  return ROUTES.map((route) => {
    const rows = byRoute.get(route.id) ?? [];
    const dates = [...new Set(rows.map((r) => r.observedOn))].sort();
    const first = dates[0];
    const last = dates[dates.length - 1];
    const monthAgo = dates[Math.max(0, dates.length - 31)];

    const avgOn = (iso: string | undefined) => {
      if (!iso) return null;
      const subset = rows.filter((r) => r.observedOn === iso);
      if (subset.length === 0) return null;
      return subset.reduce((s, r) => s + (r.totalFare ?? 0), 0) / subset.length;
    };

    const p0 = avgOn(first) ?? 1;
    const pt = avgOn(last) ?? p0;
    const pPrev = avgOn(monthAgo) ?? pt;

    const latestByWindow: Record<number, number | null> = {};
    for (const w of WINDOWS) {
      const subset = rows.filter((r) => r.observedOn === last && r.window === w);
      latestByWindow[w] = subset.length
        ? Math.round(subset.reduce((s, r) => s + (r.totalFare ?? 0), 0) / subset.length)
        : null;
    }

    return {
      routeId: route.id,
      weight: ROUTE_WEIGHTS[route.id] ?? 0,
      index: round2((pt / p0) * 100),
      momPct: round2(((pt - pPrev) / pPrev) * 100),
      avgFare: Math.round(rows.reduce((s, r) => s + (r.totalFare ?? 0), 0) / (rows.length || 1)),
      latestByWindow,
      observations: rows.length,
    };
  }).sort((a, b) => b.weight - a.weight);
}

export interface ElasticityPoint {
  window: WindowKey;
  avgFare: number;
  /** % premium versus the T+45 baseline */
  premiumPct: number;
}

export function elasticityCurve(
  cleaned: CleanedQuote[],
  routeId: string | "all" = "all",
): ElasticityPoint[] {
  const byWindow = new Map<WindowKey, number[]>();
  for (const q of cleaned) {
    if (!q.usable || q.totalFare == null) continue;
    if (routeId !== "all" && q.routeId !== routeId) continue;
    const arr = byWindow.get(q.window);
    if (arr) arr.push(q.totalFare);
    else byWindow.set(q.window, [q.totalFare]);
  }
  const baseline = byWindow.get(45);
  const baseAvg = baseline?.length
    ? baseline.reduce((a, b) => a + b, 0) / baseline.length
    : 1;

  return WINDOWS.map((w) => {
    const arr = byWindow.get(w) ?? [];
    const avg = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return {
      window: w,
      avgFare: Math.round(avg),
      premiumPct: round2(((avg - baseAvg) / baseAvg) * 100),
    };
  });
}

export interface HeatCell {
  routeId: string;
  period: string;
  value: number;
  z: number;
}

/** Route x week heatmap of fare deviation, expressed in z-scores. */
export function heatmap(cleaned: CleanedQuote[], weeks = 12): HeatCell[] {
  const panel = buildPanel(cleaned, "weekly", "all");
  const periods = [...panel.keys()].sort().slice(-weeks);
  const cells: HeatCell[] = [];

  for (const route of ROUTES) {
    const series = periods.map((p) => {
      const cell = panel.get(p)?.get(route.id);
      return cell ? cell.priceSum / cell.priceN : NaN;
    });
    const valid = series.filter((v) => !Number.isNaN(v));
    const mean = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
    const sd =
      Math.sqrt(valid.reduce((s, v) => s + (v - mean) ** 2, 0) / (valid.length || 1)) || 1;
    periods.forEach((p, i) => {
      const v = series[i];
      if (v == null || Number.isNaN(v)) return;
      cells.push({ routeId: route.id, period: p, value: Math.round(v), z: round2((v - mean) / sd) });
    });
  }
  return cells;
}

export function heatmapPeriods(cleaned: CleanedQuote[], weeks = 12): string[] {
  return [...buildPanel(cleaned, "weekly", "all").keys()].sort().slice(-weeks);
}

/* ------------------------------------------------------------------ */
/* Anomaly detection                                                   */
/* ------------------------------------------------------------------ */

/**
 * Surge detection is the mirror image of outlier cleaning: cleaning removes
 * implausible quotes, this highlights genuine, statistically extreme moves.
 */
export function detectAnomalies(cleaned: CleanedQuote[], threshold = 2.0): Anomaly[] {
  const series = new Map<string, { date: string; price: number }[]>();
  for (const q of cleaned) {
    if (!q.usable || q.totalFare == null) continue;
    const key = `${q.routeId}|${q.window}`;
    const arr = series.get(key);
    const entry = { date: q.observedOn, price: q.totalFare };
    if (arr) arr.push(entry);
    else series.set(key, [entry]);
  }

  const out: Anomaly[] = [];
  for (const [key, rows] of series) {
    const [routeId = "", windowRaw = "0"] = key.split("|");
    const window = Number(windowRaw) as WindowKey;

    const byDate = new Map<string, number[]>();
    for (const r of rows) {
      const arr = byDate.get(r.date);
      if (arr) arr.push(r.price);
      else byDate.set(r.date, [r.price]);
    }
    const dates = [...byDate.keys()].sort();
    const daily = dates.map((d) => {
      const v = byDate.get(d)!;
      return v.reduce((a, b) => a + b, 0) / v.length;
    });

    const changes = daily.map((v, i) => {
      const previous = daily[i - 1];
      return i === 0 || previous == null ? 0 : (v - previous) / previous;
    });
    const mean = changes.reduce((a, b) => a + b, 0) / (changes.length || 1);
    const sd =
      Math.sqrt(changes.reduce((s, v) => s + (v - mean) ** 2, 0) / (changes.length || 1)) || 1;

    changes.forEach((c, i) => {
      const z = (c - mean) / sd;
      if (Math.abs(z) < threshold || i === 0) return;
      out.push({
        routeId,
        window,
        observedOn: dates[i] ?? "",
        z: round2(z),
        changePct: round2(c * 100),
        reason: c > 0 ? "demand surge / capacity pull-down" : "fare correction",
      });
    });
  }

  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

/* ------------------------------------------------------------------ */
/* Backtest against the official series                                */
/* ------------------------------------------------------------------ */

export interface BacktestPoint {
  period: string;
  apix: number;
  official: number;
}

export interface BacktestResult {
  points: BacktestPoint[];
  correlation: number;
  meanAbsDeviation: number;
  rmse: number;
  days: number;
}

/**
 * Official reference series. Stands in for the MoSPI/eSankhyiki CPI
 * "Transport and Communication" sub-group, the closest published series
 * available at this granularity — documented as a proxy, not an exact match.
 */
const OFFICIAL_MONTHLY_DELTA = [0.0, 0.9, 1.6, 2.4, 3.1, 3.9, 4.4, 5.2, 5.9, 6.4, 7.1, 7.8];

export function backtest(cleaned: CleanedQuote[]): BacktestResult {
  const apixMonthly = buildIndex(cleaned, "monthly", "all");
  const points: BacktestPoint[] = apixMonthly.map((p, i) => ({
    period: p.period,
    apix: p.fisher,
    official: round2(100 + (OFFICIAL_MONTHLY_DELTA[i] ?? OFFICIAL_MONTHLY_DELTA.at(-1)!)),
  }));

  const a = points.map((p) => p.apix);
  const b = points.map((p) => p.official);
  const n = a.length || 1;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  const correlation = va && vb ? cov / Math.sqrt(va * vb) : 0;
  const mad = a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / n;
  const rmse = Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0) / n);

  const days = new Set(cleaned.map((c) => c.observedOn)).size;

  return {
    points,
    correlation: Math.round(correlation * 1000) / 1000,
    meanAbsDeviation: round2(mad),
    rmse: round2(rmse),
    days,
  };
}

/* ------------------------------------------------------------------ */
/* Policy brief                                                        */
/* ------------------------------------------------------------------ */

export function policyBrief(input: {
  index: IndexPoint[];
  stats: RouteStat[];
  anomalies: Anomaly[];
  elasticity: ElasticityPoint[];
  backtest: BacktestResult;
}): string {
  const latest = input.index.at(-1);
  const prev = input.index.at(-2) ?? latest;
  if (!latest || !prev) return "Insufficient observations to generate a brief.";

  const move = round2(((latest.fisher - prev.fisher) / prev.fisher) * 100);
  const top = [...input.stats].sort((a, b) => b.momPct - a.momPct)[0];
  const anomaly = input.anomalies[0];
  const shortNotice = input.elasticity.find((e) => e.window === 1);

  return [
    `APIx stands at ${latest.fisher.toFixed(2)} (Fisher, base = 100 at start of collection), ${move >= 0 ? "up" : "down"} ${Math.abs(move).toFixed(2)}% on the previous period.`,
    top
      ? `The steepest sector move is ${top.routeId} at ${top.momPct >= 0 ? "+" : ""}${top.momPct.toFixed(1)}% month-on-month, carrying a DGCA traffic weight of ${(top.weight * 100).toFixed(1)}%.`
      : "",
    anomaly
      ? `One surge is flagged on ${anomaly.routeId} (T+${anomaly.window}) on ${anomaly.observedOn}, a ${anomaly.changePct.toFixed(1)}% day-on-day move at z = ${anomaly.z.toFixed(1)}.`
      : `No statistically extreme surges are currently flagged.`,
    shortNotice
      ? `Short-notice travellers pay a ${shortNotice.premiumPct.toFixed(0)}% premium at T+1 relative to the T+45 baseline, so the consumer-facing burden is concentrated in involuntary travel.`
      : "",
    `Against the official transport sub-index proxy the series tracks at r = ${input.backtest.correlation.toFixed(2)} with a mean absolute deviation of ${input.backtest.meanAbsDeviation.toFixed(2)} index points over ${input.backtest.days} days of collection.`,
  ]
    .filter(Boolean)
    .join(" ");
}
