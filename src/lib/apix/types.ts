export type WindowKey = 1 | 7 | 15 | 30 | 45;

export const WINDOWS: WindowKey[] = [1, 7, 15, 30, 45];

export interface RouteDef {
  id: string;
  origin: string;
  dest: string;
  /** DGCA-derived passenger traffic share (raw, normalised at load) */
  trafficShare: number;
  /** anchor economy base fare in INR at T+45 */
  baseFare: number;
  /** relative fare volatility of the sector */
  volatility: number;
}

export type QuoteStatus = "active" | "sold_out" | "cancelled";

export interface FareQuote {
  id: string;
  routeId: string;
  carrier: string;
  source: string;
  window: WindowKey;
  /** observation (scrape) date, ISO yyyy-mm-dd */
  observedOn: string;
  /** departure date = observedOn + window */
  flightDate: string;
  status: QuoteStatus;
  baseFare: number | null;
  taxes: number | null;
  udf: number | null;
  convenienceFee: number | null;
  totalFare: number | null;
  /** seats sold proxy used for Paasche quantities */
  quantity: number;
}

export interface CleanedQuote extends FareQuote {
  outlier: boolean;
  /** included in index computation */
  usable: boolean;
}

export interface IndexPoint {
  period: string;
  laspeyres: number;
  paasche: number;
  fisher: number;
}

export interface Anomaly {
  routeId: string;
  window: WindowKey;
  observedOn: string;
  z: number;
  changePct: number;
  reason: string;
}

export interface ComplianceEvent {
  at: string;
  source: string;
  kind: "robots" | "ratelimit" | "backoff" | "fetch" | "cache";
  detail: string;
  ok: boolean;
}

export type Frequency = "daily" | "weekly" | "monthly";
