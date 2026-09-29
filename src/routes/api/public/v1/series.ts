import { createFileRoute } from "@tanstack/react-router";

import { buildDataset } from "@/lib/apix/dataset";
import { buildIndex } from "@/lib/apix/pipeline";
import type { Frequency, WindowKey } from "@/lib/apix/types";

const FREQS: Frequency[] = ["daily", "weekly", "monthly"];
const WINDOWS: WindowKey[] = [1, 7, 15, 30, 45];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

export const Route = createFileRoute("/api/public/v1/series")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const freqParam = (url.searchParams.get("freq") ?? "daily") as Frequency;
        if (!FREQS.includes(freqParam)) {
          return json({ error: "freq must be one of daily, weekly, monthly" }, 400);
        }

        const windowParam = url.searchParams.get("window");
        let window: WindowKey | "all" = "all";
        if (windowParam) {
          const w = Number(windowParam) as WindowKey;
          if (!WINDOWS.includes(w)) {
            return json({ error: "window must be one of 1, 7, 15, 30, 45" }, 400);
          }
          window = w;
        }

        const data = buildDataset();
        const points =
          window === "all" ? data.series[freqParam] : buildIndex(data.cleaned, freqParam, window);

        return json({
          index: "APIx — Real-time Airfare Price Index",
          methodology: {
            formula: "Fisher ideal (geometric mean of Laspeyres and Paasche)",
            weights: "DGCA domestic passenger-traffic share per route, normalised to 1",
            basePeriod: points[0]?.period ?? null,
            baseValue: 100,
          },
          frequency: freqParam,
          advancePurchaseWindow: window === "all" ? "all" : `T+${window}`,
          observationDays: data.observationDays,
          lastObserved: data.lastObserved,
          points,
        });
      },
    },
  },
});
