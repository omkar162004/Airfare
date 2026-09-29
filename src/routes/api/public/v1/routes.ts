import { createFileRoute } from "@tanstack/react-router";

import { buildDataset } from "@/lib/apix/dataset";
import { ROUTES } from "@/lib/apix/routes";

export const Route = createFileRoute("/api/public/v1/routes")({
  server: {
    handlers: {
      GET: async () => {
        const data = buildDataset();
        const meta = new Map(ROUTES.map((r) => [r.id, r]));

        return new Response(
          JSON.stringify(
            {
              basket: "Representative domestic city-pairs, DGCA traffic-selected",
              weightSource: "DGCA monthly domestic traffic share (proxy weights)",
              routes: data.stats.map((s) => ({
                route: s.routeId,
                origin: meta.get(s.routeId)?.origin,
                destination: meta.get(s.routeId)?.dest,
                weight: Number(s.weight.toFixed(4)),
                index: s.index,
                momPct: s.momPct,
                meanFareInr: s.avgFare,
                latestFareByWindow: s.latestByWindow,
                observations: s.observations,
              })),
            },
            null,
            2,
          ),
          {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "public, max-age=300",
              "access-control-allow-origin": "*",
            },
          },
        );
      },
    },
  },
});
