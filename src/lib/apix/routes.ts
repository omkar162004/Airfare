import type { RouteDef } from "./types";

/**
 * Basket of representative city-pairs.
 * trafficShare values are derived from DGCA domestic passenger-traffic
 * proportions for these sectors and are normalised to sum to 1 at load time.
 * Treated as a proxy weight set — documented as a known limitation.
 */
export const ROUTES: RouteDef[] = [
  { id: "DEL-BOM", origin: "DEL", dest: "BOM", trafficShare: 0.212, baseFare: 4850, volatility: 0.26 },
  { id: "DEL-BLR", origin: "DEL", dest: "BLR", trafficShare: 0.168, baseFare: 5240, volatility: 0.29 },
  { id: "BOM-BLR", origin: "BOM", dest: "BLR", trafficShare: 0.121, baseFare: 3980, volatility: 0.24 },
  { id: "DEL-CCU", origin: "DEL", dest: "CCU", trafficShare: 0.104, baseFare: 5010, volatility: 0.22 },
  { id: "BLR-HYD", origin: "BLR", dest: "HYD", trafficShare: 0.087, baseFare: 3120, volatility: 0.19 },
  { id: "MAA-DEL", origin: "MAA", dest: "DEL", trafficShare: 0.096, baseFare: 5680, volatility: 0.27 },
  { id: "BOM-MAA", origin: "BOM", dest: "MAA", trafficShare: 0.079, baseFare: 3760, volatility: 0.21 },
  { id: "DEL-GOI", origin: "DEL", dest: "GOI", trafficShare: 0.068, baseFare: 5920, volatility: 0.34 },
];

const shareTotal = ROUTES.reduce((s, r) => s + r.trafficShare, 0);

/** Normalised DGCA-derived weights, guaranteed to sum to 1. */
export const ROUTE_WEIGHTS: Record<string, number> = Object.fromEntries(
  ROUTES.map((r) => [r.id, r.trafficShare / shareTotal]),
);

export const SOURCES = [
  { id: "airline-direct", label: "Airline direct (JSON search endpoint)", delayMs: 2500 },
  { id: "ota-aggregator", label: "OTA aggregator (rendered search)", delayMs: 4000 },
];

export const CARRIERS = ["IndiGo", "Air India", "Air India Express", "Akasa Air", "SpiceJet"];

export function routeById(id: string): RouteDef | undefined {
  return ROUTES.find((r) => r.id === id);
}
