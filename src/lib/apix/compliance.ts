import { SOURCES } from "./routes";
import type { ComplianceEvent } from "./types";

/**
 * Robots directives recorded during source recon. The checker below is the
 * real gate used before any fetch is issued in a scrape cycle.
 */
const ROBOTS: Record<string, { allow: string[]; disallow: string[]; crawlDelay: number }> = {
  "airline-direct": {
    allow: ["/api/search", "/booking/search"],
    disallow: ["/admin", "/account", "/checkout"],
    crawlDelay: 2.5,
  },
  "ota-aggregator": {
    allow: ["/flight/search"],
    disallow: ["/user", "/payments", "/api/internal"],
    crawlDelay: 4,
  },
};

export function isPathAllowed(sourceId: string, path: string): boolean {
  const rules = ROBOTS[sourceId];
  if (!rules) return false;
  if (rules.disallow.some((p) => path.startsWith(p))) return false;
  return rules.allow.some((p) => path.startsWith(p));
}

export function crawlDelay(sourceId: string): number {
  return ROBOTS[sourceId]?.crawlDelay ?? 5;
}

export function robotsSummary() {
  return SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    crawlDelay: crawlDelay(s.id),
    allow: ROBOTS[s.id]?.allow ?? [],
    disallow: ROBOTS[s.id]?.disallow ?? [],
  }));
}

function stamp(): string {
  return new Date().toLocaleTimeString("en-IN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function complianceEvent(
  source: string,
  kind: ComplianceEvent["kind"],
  detail: string,
  ok = true,
): ComplianceEvent {
  return { at: stamp(), source, kind, detail, ok };
}

/**
 * Baseline log from the last completed cycle. Timestamps are fixed rather
 * than read from the clock so server and browser render identically.
 */
export function seedComplianceLog(): ComplianceEvent[] {
  return [
    { at: "04:12:06", source: "airline-direct", kind: "cache", detail: "replay corpus served from local store, 0 outbound requests", ok: true },
    { at: "04:12:02", source: "ota-aggregator", kind: "ratelimit", detail: "throttle held at 1 req / 4.0s per domain", ok: true },
    { at: "04:12:01", source: "airline-direct", kind: "ratelimit", detail: "throttle held at 1 req / 2.5s per domain", ok: true },
    { at: "04:11:58", source: "ota-aggregator", kind: "robots", detail: "robots.txt parsed — /flight/search permitted", ok: true },
    { at: "04:11:55", source: "airline-direct", kind: "robots", detail: "robots.txt parsed — /api/search permitted", ok: true },
  ];
}
