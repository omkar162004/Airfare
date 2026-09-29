import { generateQuotes } from "./generate";
import {
  backtest,
  buildIndex,
  cleanQuotes,
  detectAnomalies,
  elasticityCurve,
  heatmap,
  heatmapPeriods,
  policyBrief,
  routeStats,
} from "./pipeline";
import type { Frequency, WindowKey } from "./types";

/**
 * One end-to-end pass of the pipeline: ingest -> clean -> index -> analytics.
 * Pure and deterministic for a given salt, so the SSR pass, the browser and
 * the public API all agree on the same numbers.
 */
export function buildDataset(salt = "replay", days = 120) {
  const raw = generateQuotes({ days, salt });
  const { cleaned, report } = cleanQuotes(raw);

  const daily = buildIndex(cleaned, "daily");
  const weekly = buildIndex(cleaned, "weekly");
  const monthly = buildIndex(cleaned, "monthly");
  const stats = routeStats(cleaned);
  const elasticity = elasticityCurve(cleaned);
  const anomalies = detectAnomalies(cleaned).slice(0, 12);
  const bt = backtest(cleaned);

  return {
    salt,
    raw,
    cleaned,
    report,
    series: { daily, weekly, monthly } as Record<Frequency, typeof daily>,
    stats,
    elasticity,
    anomalies,
    backtest: bt,
    heat: { cells: heatmap(cleaned), periods: heatmapPeriods(cleaned) },
    brief: policyBrief({ index: daily, stats, anomalies, elasticity, backtest: bt }),
    windowIndex: Object.fromEntries(
      ([1, 7, 15, 30, 45] as WindowKey[]).map((w) => [
        w,
        buildIndex(cleaned, "daily", w).at(-1)?.fisher ?? 0,
      ]),
    ) as Record<WindowKey, number>,
    observationDays: new Set(cleaned.map((c) => c.observedOn)).size,
    lastObserved: [...new Set(cleaned.map((c) => c.observedOn))].sort().at(-1) ?? "",
  };
}

export type Dataset = ReturnType<typeof buildDataset>;
