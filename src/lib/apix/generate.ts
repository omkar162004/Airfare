import { CARRIERS, ROUTES, SOURCES } from "./routes";
import { WINDOWS, type FareQuote, type QuoteStatus, type WindowKey } from "./types";

/** Deterministic PRNG so every render/SSR pass produces the same corpus. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Lead-time curve: fares climb sharply as departure approaches. */
function leadFactor(window: WindowKey): number {
  const table: Record<WindowKey, number> = { 1: 1.82, 7: 1.44, 15: 1.21, 30: 1.06, 45: 1.0 };
  return table[window];
}

/** Seasonal + weekday shape of demand across the observation window. */
function seasonal(dayIndex: number, total: number, iso: string): number {
  const phase = (dayIndex / total) * Math.PI * 2;
  const trend = 1 + (dayIndex / total) * 0.09;
  const wave = 1 + Math.sin(phase * 1.5) * 0.045;
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  const weekend = dow === 5 || dow === 0 ? 1.06 : dow === 2 || dow === 3 ? 0.97 : 1.0;
  return trend * wave * weekend;
}

/** Festival / event style surge days expressed as offsets into the window. */
const SURGE_DAYS = new Set([23, 24, 25, 58, 59, 86, 87, 88]);

export interface GenerateOptions {
  /** number of observation days of history */
  days?: number;
  /** last observation date (inclusive), ISO */
  endDate?: string;
  /** extra entropy — a fresh live scrape cycle shifts this */
  salt?: string;
}

export function generateQuotes(options: GenerateOptions = {}): FareQuote[] {
  const days = options.days ?? 120;
  const endDate = options.endDate ?? isoDate(new Date());
  const salt = options.salt ?? "replay";
  const quotes: FareQuote[] = [];

  for (let i = 0; i < days; i++) {
    const dayIndex = days - 1 - i;
    const observedOn = addDays(endDate, -dayIndex);
    const offsetFromStart = i;

    for (const route of ROUTES) {
      const season = seasonal(offsetFromStart, days, observedOn);
      const surge = SURGE_DAYS.has(offsetFromStart)
        ? 1 + 0.35 + route.volatility * 0.9
        : 1;

      for (const window of WINDOWS) {
        for (const source of SOURCES) {
          const rnd = mulberry32(
            hashString(`${salt}|${route.id}|${observedOn}|${window}|${source.id}`),
          );
          const carrier = CARRIERS[Math.floor(rnd() * CARRIERS.length)] ?? "IndiGo";
          const noise = 1 + (rnd() - 0.5) * route.volatility;
          const sourceSpread = source.id === "ota-aggregator" ? 1.024 : 1.0;

          // ~3% of probes come back with no availability; ~1% cancelled.
          const roll = rnd();
          let status: QuoteStatus = "active";
          if (roll > 0.985) status = "cancelled";
          else if (roll > 0.955) status = "sold_out";

          // ~1.5% of probes are corrupted quotes -> genuine outliers to clean.
          const corrupt = rnd() > 0.985;

          let total: number | null = null;
          let base: number | null = null;
          let taxes: number | null = null;
          let udf: number | null = null;
          let convenience: number | null = null;

          if (status === "active") {
            const raw =
              route.baseFare * leadFactor(window) * season * noise * surge * sourceSpread;
            total = Math.round((corrupt ? raw * (rnd() > 0.5 ? 6.4 : 0.12) : raw) / 10) * 10;

            // Fare decomposition. The OTA source does not itemise base fare.
            if (source.id === "ota-aggregator" && rnd() > 0.6) {
              base = null;
              taxes = null;
              udf = null;
              convenience = Math.round(total * 0.012);
            } else {
              udf = window === 1 ? 236 : 236;
              convenience = source.id === "ota-aggregator" ? Math.round(total * 0.012) : 0;
              taxes = Math.round((total - udf - convenience) * 0.0975);
              base = total - udf - convenience - taxes;
            }
          }

          quotes.push({
            id: `${route.id}-${observedOn}-${window}-${source.id}`,
            routeId: route.id,
            carrier,
            source: source.id,
            window,
            observedOn,
            flightDate: addDays(observedOn, window),
            status,
            baseFare: base,
            taxes,
            udf,
            convenienceFee: convenience,
            totalFare: total,
            // Paasche quantity proxy: seats sold, drifts with demand.
            quantity: Math.round(route.trafficShare * 100000 * season * (0.9 + rnd() * 0.2)),
          });
        }
      }
    }
  }

  return quotes;
}
