import { createFileRoute } from "@tanstack/react-router";

import { buildDataset } from "@/lib/apix/dataset";

export const Route = createFileRoute("/api/public/v1/anomalies")({
  server: {
    handlers: {
      GET: async () => {
        const data = buildDataset();
        return new Response(
          JSON.stringify(
            {
              detector: "z-score on day-on-day mean fare change per route × window",
              threshold: 2.0,
              note: "Surges are retained in the index; only implausible quotes are removed by the IQR×3 cleaning fence.",
              cleaning: data.report,
              anomalies: data.anomalies,
              backtest: {
                correlation: data.backtest.correlation,
                meanAbsDeviation: data.backtest.meanAbsDeviation,
                rmse: data.backtest.rmse,
                referenceSeries: "MoSPI transport sub-group proxy",
              },
              brief: data.brief,
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
