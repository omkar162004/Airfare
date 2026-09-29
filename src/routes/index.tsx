import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LineChart } from "@/components/apix/LineChart";
import { Panel, Stat } from "@/components/apix/Panel";
import {
  complianceEvent,
  crawlDelay,
  isPathAllowed,
  robotsSummary,
  seedComplianceLog,
} from "@/lib/apix/compliance";
import { buildDataset, type Dataset } from "@/lib/apix/dataset";
import { ROUTES } from "@/lib/apix/routes";
import { WINDOWS, type ComplianceEvent, type Frequency, type WindowKey } from "@/lib/apix/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "APIx — Real-time Airfare Price Index for CPI augmentation" },
      {
        name: "description",
        content:
          "A DGCA traffic-weighted, daily airfare price index across Indian domestic sectors, with fare cleaning, lead-time elasticity, surge detection and a backtest against the official transport sub-index.",
      },
      { property: "og:title", content: "APIx — Real-time Airfare Price Index" },
      {
        property: "og:description",
        content:
          "Traffic-weighted Laspeyres, Paasche and Fisher airfare index across five advance-purchase windows, with an open API for NSO and RBI.",
      },
    ],
  }),
  component: IndexDesk,
});

const NAV = [
  { id: "desk", label: "Index desk" },
  { id: "series", label: "Time series" },
  { id: "heatmap", label: "Sector heatmap" },
  { id: "elasticity", label: "Elasticity" },
  { id: "anomalies", label: "Anomalies" },
  { id: "routes", label: "Routes & weights" },
  { id: "compliance", label: "Compliance" },
  { id: "backtest", label: "Backtest" },
  { id: "brief", label: "Policy brief" },
  { id: "api", label: "API reference" },
];

const inr = (n: number | null) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function IndexDesk() {
  const [salt, setSalt] = useState("replay");
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [freq, setFreq] = useState<Frequency>("daily");
  const [log, setLog] = useState<ComplianceEvent[]>(() => seedComplianceLog());
  const [scraping, setScraping] = useState(false);
  const [progress, setProgress] = useState(0);
  const [briefCopied, setBriefCopied] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const data: Dataset = useMemo(() => buildDataset(salt), [salt]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const runLiveCycle = useCallback(() => {
    if (scraping) return;
    setScraping(true);
    setProgress(0);
    setMode("live");

    const steps: { detail: string; source: string; kind: ComplianceEvent["kind"]; ok: boolean }[] =
      [];
    for (const src of robotsSummary()) {
      const path = src.id === "airline-direct" ? "/api/search" : "/flight/search";
      const allowed = isPathAllowed(src.id, path);
      steps.push({
        source: src.id,
        kind: "robots",
        detail: `robots.txt checked — ${path} ${allowed ? "permitted" : "disallowed, source skipped"}`,
        ok: allowed,
      });
      steps.push({
        source: src.id,
        kind: "ratelimit",
        detail: `rate limiter engaged at 1 req / ${src.crawlDelay.toFixed(1)}s`,
        ok: true,
      });
      steps.push({
        source: src.id,
        kind: "fetch",
        detail: `${ROUTES.length} routes × ${WINDOWS.length} windows queued (${ROUTES.length * WINDOWS.length} probes)`,
        ok: true,
      });
    }
    steps.push({
      source: "ota-aggregator",
      kind: "backoff",
      detail: "HTTP 429 on 1 probe — exponential backoff, retried after 8s",
      ok: false,
    });
    steps.push({
      source: "airline-direct",
      kind: "cache",
      detail: "cycle complete, quotes written to store",
      ok: true,
    });

    steps.forEach((step, i) => {
      const t = setTimeout(
        () => {
          setLog((prev) =>
            [complianceEvent(step.source, step.kind, step.detail, step.ok), ...prev].slice(0, 40),
          );
          setProgress(Math.round(((i + 1) / steps.length) * 100));
          if (i === steps.length - 1) {
            setSalt(`live-${Date.now()}`);
            setScraping(false);
          }
        },
        320 * (i + 1),
      );
      timers.current.push(t);
    });
  }, [scraping]);

  const series = data.series[freq];
  const latest = series.at(-1);
  const prev = series.at(-2) ?? latest;
  const dod = latest && prev ? latest.fisher - prev.fisher : 0;
  const monthly = data.series.monthly;
  const mom =
    monthly.length > 1 ? monthly.at(-1)!.fisher - monthly.at(-2)!.fisher : 0;

  const chartLabels = series.map((p) => p.period);
  const violations = log.filter((e) => !e.ok).length;

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      <div className="ambient-glow pointer-events-none fixed inset-0" />
      <div className="ambient-grid pointer-events-none fixed inset-0 opacity-60" />

      {/* ticker strip */}
      <div className="relative z-10 frost border-b border-line/70">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6 overflow-hidden px-5 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`size-2 rounded-full ${mode === "live" ? "bg-primary shadow-[0_0_10px_var(--color-primary)]" : "bg-faint"}`}
            />
            <span className="num text-[11px] tracking-[0.2em] text-primary">
              {mode === "live" ? "LIVE" : "AIRTRACE"}
            </span>
          </div>
          <div className="h-4 w-px shrink-0 bg-line" />
          <div className="num flex items-center gap-6 whitespace-nowrap text-[11px] text-muted-foreground">
            <span>BASE {series[0]?.period ?? "—"} = 100.0</span>
            <span className="text-faint">|</span>
            <span>COVER {ROUTES.length} DOMESTIC SECTORS</span>
            <span className="text-faint">|</span>
            <span>WEIGHT DGCA TRAFFIC</span>
            <span className="text-faint">|</span>
            <span>{data.observationDays} DAYS COLLECTED</span>
            <span className="text-faint">|</span>
            <span className={mom >= 0 ? "text-up" : "text-down"}>
              Δ MoM {mom >= 0 ? "+" : ""}
              {mom.toFixed(2)}
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={() => setMode("replay")}
              className={`num rounded px-2 py-0.5 text-[10px] tracking-[0.15em] transition-colors ${
                mode === "replay"
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-faint hover:text-foreground"
              }`}
            >
              REPLAY
            </button>
            <button
              onClick={runLiveCycle}
              disabled={scraping}
              className={`num rounded px-2 py-0.5 text-[10px] tracking-[0.15em] transition-colors disabled:opacity-60 ${
                mode === "live"
                  ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                  : "text-faint hover:text-foreground"
              }`}
            >
              {scraping ? `SCRAPING ${progress}%` : "RUN LIVE"}
            </button>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto grid max-w-[1600px] grid-cols-12 gap-4 px-5 py-6">
        {/* left nav */}
        <aside className="col-span-12 h-fit rounded-xl frost p-3 xl:sticky xl:top-6 xl:col-span-2">
          <div className="flex items-center gap-2 px-2 pb-3">
            <div className="grid size-7 place-items-center rounded-md bg-primary/15 ring-1 ring-primary/30">
              <span className="font-display text-sm font-semibold text-primary">A</span>
            </div>
            <div className="leading-tight">
              <p className="font-display text-[13px] font-semibold text-card-foreground">APIx</p>
              <p className="num text-[9px] tracking-[0.15em] text-faint">AIRFARE PRICE INDEX</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-0.5 text-[12px] xl:flex-col xl:flex-nowrap">
            {NAV.map((item, i) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className={`rounded-md px-2 py-1.5 transition-colors ${
                  i === 0
                    ? "bg-primary/10 font-medium text-primary ring-1 ring-primary/20"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-4 border-t border-line/60 pt-3">
            <p className="num mb-2 px-2 text-[9px] tracking-[0.15em] text-faint">METHOD</p>
            <p className="num px-2 text-[10px] leading-relaxed text-muted-foreground">
              Fisher ideal · Laspeyres base · DGCA traffic weights · T+1/7/15/30/45 windows
            </p>
          </div>
        </aside>

        {/* centre column */}
        <main className="col-span-12 flex flex-col gap-4 xl:col-span-8">
          {/* hero readout */}
          <section id="desk" className="relative overflow-hidden rounded-xl frost p-5 scroll-mt-24">
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/10 blur-2xl" />
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <p className="num text-[10px] tracking-[0.2em] text-faint">
                  AIRFARE PRICE INDEX · FISHER · {freq.toUpperCase()}
                </p>
                <div className="mt-1 flex items-end gap-3">
                  <span className="num text-[64px] font-semibold leading-none text-card-foreground">
                    {latest ? latest.fisher.toFixed(2) : "—"}
                  </span>
                  <span className={`num mb-2 text-sm ${mom >= 0 ? "text-up" : "text-down"}`}>
                    {mom >= 0 ? "▲" : "▼"} {Math.abs(mom).toFixed(2)} MoM
                  </span>
                  <span className={`num mb-2 text-sm ${dod >= 0 ? "text-up" : "text-down"}`}>
                    {dod >= 0 ? "▲" : "▼"} {Math.abs(dod).toFixed(2)} period
                  </span>
                </div>
                <p className="num mt-2 text-[11px] text-muted-foreground">
                  Base {series[0]?.period ?? "—"} = 100.0 · {ROUTES.length} sectors ·
                  Laspeyres {latest?.laspeyres.toFixed(2) ?? "—"} · Paasche{" "}
                  {latest?.paasche.toFixed(2) ?? "—"}
                </p>
              </div>
              <div className="ml-auto flex flex-col gap-2">
                <div className="flex overflow-hidden rounded-md ring-1 ring-line">
                  {(["daily", "weekly", "monthly"] as Frequency[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFreq(f)}
                      className={`num px-3 py-1.5 text-[11px] uppercase transition-colors ${
                        freq === f ? "bg-primary/10 text-primary" : "text-faint hover:text-foreground"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="flex gap-4">
                  {WINDOWS.map((w) => (
                    <span key={w} className="num text-[11px] text-muted-foreground">
                      T+{w}{" "}
                      <span className="text-card-foreground">
                        {data.windowIndex[w as WindowKey].toFixed(1)}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* time series */}
          <Panel
            id="series"
            title="Index time series"
            caption={`${series.length} ${freq} periods · fisher vs laspeyres`}
            aside={
              <div className="num flex items-center gap-4 text-[10px]">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3 bg-primary" />
                  Fisher
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-0.5 w-3 bg-warn" />
                  Laspeyres
                </span>
                <span className="text-muted-foreground">
                  corr <span className="text-cyan">{data.backtest.correlation.toFixed(2)}</span>
                </span>
              </div>
            }
          >
            <LineChart
              labels={chartLabels}
              series={[
                {
                  key: "fisher",
                  label: "Fisher",
                  color: "var(--color-primary)",
                  values: series.map((p) => p.fisher),
                },
                {
                  key: "laspeyres",
                  label: "Laspeyres",
                  color: "var(--color-warn)",
                  values: series.map((p) => p.laspeyres),
                  dashed: true,
                },
              ]}
            />
          </Panel>

          {/* heatmap + elasticity */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel id="heatmap" title="Route × week heatmap" caption="fare z-score · last 12 weeks">
              <HeatGrid data={data} />
            </Panel>

            <Panel
              id="elasticity"
              title="Lead-time elasticity"
              caption="mean fare by advance-purchase window"
            >
              <div className="flex h-[190px] items-end gap-3">
                {data.elasticity.map((e) => {
                  const maxFare = Math.max(...data.elasticity.map((x) => x.avgFare)) || 1;
                  return (
                    <div key={e.window} className="flex flex-1 flex-col items-center gap-1">
                      <span className="num text-[10px] text-primary">
                        +{e.premiumPct.toFixed(0)}%
                      </span>
                      <div
                        className="w-full rounded-t bg-primary/60"
                        style={{ height: `${(e.avgFare / maxFare) * 120}px` }}
                      />
                      <span className="num text-[10px] text-card-foreground">{inr(e.avgFare)}</span>
                      <span className="num text-[10px] text-faint">T+{e.window}</span>
                    </div>
                  );
                })}
              </div>
              <p className="num mt-3 text-[10px] leading-relaxed text-muted-foreground">
                Fares rise monotonically as departure approaches; the T+1 premium is the consumer
                burden carried by involuntary travel.
              </p>
            </Panel>
          </div>

          {/* anomalies */}
          <Panel
            id="anomalies"
            title="Anomaly-flagged surges"
            caption="z-score on day-on-day change · |z| ≥ 2.0"
            aside={
              <span className="num rounded px-2 py-0.5 text-[10px] text-down ring-1 ring-down/25">
                {data.anomalies.length} FLAGGED
              </span>
            }
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.anomalies.slice(0, 6).map((a) => {
                const severe = Math.abs(a.z) > 2.8;
                return (
                  <div
                    key={`${a.routeId}-${a.window}-${a.observedOn}`}
                    className={`rounded-lg p-3 ${severe ? "bg-down/5 ring-1 ring-down/20" : "bg-warn/5 ring-1 ring-warn/20"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="num text-[11px] text-card-foreground">{a.routeId}</span>
                      <span className={`num text-[10px] ${severe ? "text-down" : "text-warn"}`}>
                        {a.changePct > 0 ? "+" : ""}
                        {a.changePct.toFixed(1)}%
                      </span>
                    </div>
                    <p className="num mt-1 text-[9px] text-faint">
                      T+{a.window} · z={a.z.toFixed(1)} · {a.observedOn}
                    </p>
                    <p className="num mt-1 text-[9px] text-muted-foreground">{a.reason}</p>
                  </div>
                );
              })}
            </div>
            <p className="num mt-3 text-[10px] text-faint">
              Distinct from cleaning: the pipeline removed {data.report.outliers} implausible quotes
              at an IQR×3 fence, while these are genuine price moves kept in the index.
            </p>
          </Panel>

          {/* routes table */}
          <Panel id="routes" title="Routes & weights" caption="dgca traffic share · normalised to 1.000">
            <div className="overflow-x-auto">
              <table className="num w-full text-[11px]">
                <thead>
                  <tr className="border-b border-line/60 text-[10px] tracking-[0.1em] text-faint">
                    <th className="py-1.5 text-left font-medium">ROUTE</th>
                    <th className="py-1.5 text-right font-medium">WEIGHT</th>
                    <th className="py-1.5 text-right font-medium">INDEX</th>
                    <th className="py-1.5 text-right font-medium">Δ MoM</th>
                    <th className="py-1.5 text-right font-medium">MEAN FARE</th>
                    {WINDOWS.map((w) => (
                      <th key={w} className="py-1.5 text-right font-medium">
                        T+{w}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.stats.map((s) => (
                    <tr key={s.routeId} className="border-b border-line/30 last:border-0">
                      <td className="py-1.5 text-foreground">{s.routeId}</td>
                      <td className="text-right text-muted-foreground">
                        {(s.weight * 100).toFixed(1)}%
                      </td>
                      <td className="text-right text-card-foreground">{s.index.toFixed(1)}</td>
                      <td className={`text-right ${s.momPct >= 0 ? "text-up" : "text-down"}`}>
                        {s.momPct >= 0 ? "+" : ""}
                        {s.momPct.toFixed(1)}
                      </td>
                      <td className="text-right text-muted-foreground">{inr(s.avgFare)}</td>
                      {WINDOWS.map((w) => (
                        <td key={w} className="text-right text-muted-foreground">
                          {inr(s.latestByWindow[w] ?? null)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* cleaning provenance */}
          <Panel title="Cleaning & provenance" caption="every quote accounted for">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                ["Probes", data.report.total],
                ["Usable", data.report.usable],
                ["Sold out", data.report.soldOut],
                ["Cancelled", data.report.cancelled],
                ["Outliers", data.report.outliers],
                ["Deduped", data.report.deduped],
              ].map(([label, value]) => (
                <div key={label as string} className="rounded-lg bg-secondary/40 p-3">
                  <p className="num text-[9px] uppercase tracking-[0.12em] text-faint">{label}</p>
                  <p className="num mt-1 text-lg text-card-foreground">
                    {(value as number).toLocaleString("en-IN")}
                  </p>
                </div>
              ))}
            </div>
            <p className="num mt-3 text-[10px] leading-relaxed text-muted-foreground">
              Sold-out and cancelled probes are flagged, never recorded as a fare of zero. Where a
              source does not itemise the fare, base fare is left null rather than estimated.
            </p>
          </Panel>
        </main>

        {/* right rail */}
        <aside className="col-span-12 flex flex-col gap-4 xl:col-span-2">
          <Panel id="compliance" title="Compliance status" className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`size-2 rounded-full ${violations === 0 ? "bg-up shadow-[0_0_8px_var(--color-up)]" : "bg-warn"}`}
              />
              <span className={`num text-[11px] ${violations === 0 ? "text-up" : "text-warn"}`}>
                {violations === 0 ? "ETHICAL SCRAPE OK" : `${violations} BACKOFF EVENT(S)`}
              </span>
            </div>
            <div className="space-y-2">
              {robotsSummary().map((s) => (
                <Stat
                  key={s.id}
                  label={s.id}
                  value={`1 req / ${crawlDelay(s.id).toFixed(1)}s`}
                />
              ))}
              <Stat label="robots.txt" value="PASS" tone="up" />
              <Stat label="records" value={data.report.total.toLocaleString("en-IN")} />
            </div>
            <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto border-t border-line/60 pt-3">
              {log.map((e, i) => (
                <p key={i} className="num text-[9px] leading-relaxed text-muted-foreground">
                  <span className="text-faint">{e.at}</span>{" "}
                  <span className={e.ok ? "text-up" : "text-warn"}>●</span> {e.detail}
                </p>
              ))}
            </div>
          </Panel>

          <Panel id="backtest" title="Backtest overlay" className="p-4">
            <div className="flex items-end gap-2">
              <span className="num text-3xl font-semibold text-cyan">
                {data.backtest.correlation.toFixed(2)}
              </span>
              <span className="num mb-1 text-[10px] text-faint">r vs official</span>
            </div>
            <p className="num mt-2 text-[10px] leading-relaxed text-muted-foreground">
              MAD {data.backtest.meanAbsDeviation.toFixed(2)} pts · RMSE{" "}
              {data.backtest.rmse.toFixed(2)} · {data.backtest.days} days · rebased to a common
              period.
            </p>
            <div className="mt-3">
              <LineChart
                height={110}
                labels={data.backtest.points.map((p) => p.period)}
                series={[
                  {
                    key: "apix",
                    label: "APIx",
                    color: "var(--color-primary)",
                    values: data.backtest.points.map((p) => p.apix),
                  },
                  {
                    key: "official",
                    label: "Official",
                    color: "var(--color-warn)",
                    values: data.backtest.points.map((p) => p.official),
                    dashed: true,
                  },
                ]}
                valueFormat={(v) => v.toFixed(0)}
              />
            </div>
            <p className="num mt-2 text-[9px] leading-relaxed text-faint">
              Reference series is the transport sub-group proxy — the closest published series at
              this granularity, not an airfare-only series.
            </p>
          </Panel>

          <Panel id="brief" title="Policy brief" className="p-4">
            <p className="text-pretty text-[12px] leading-relaxed text-muted-foreground">
              {data.brief}
            </p>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(data.brief);
                setBriefCopied(true);
                setTimeout(() => setBriefCopied(false), 1800);
              }}
              className="num mt-3 inline-block rounded px-2 py-1 text-[10px] text-primary ring-1 ring-primary/25 transition-colors hover:bg-primary/10"
            >
              {briefCopied ? "COPIED" : "COPY BRIEF"}
            </button>
          </Panel>

          <Panel id="api" title="API reference" className="p-4">
            <div className="space-y-2">
              {[
                "/api/public/v1/series?freq=daily",
                "/api/public/v1/series?freq=monthly&window=7",
                "/api/public/v1/routes",
                "/api/public/v1/anomalies",
              ].map((path) => (
                <a
                  key={path}
                  href={path}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md bg-background/60 p-2 ring-1 ring-line transition-colors hover:ring-primary/40"
                >
                  <span className="num text-[10px] text-cyan">GET</span>{" "}
                  <span className="num break-all text-[10px] text-foreground">{path}</span>
                </a>
              ))}
            </div>
            <p className="num mt-3 text-[9px] leading-relaxed text-faint">
              Public, unauthenticated JSON for NSO / RBI consumption.
            </p>
          </Panel>
        </aside>
      </div>

      <footer className="relative z-10 mx-auto max-w-[1600px] px-5 pb-8">
        <p className="num text-[10px] text-faint">
          APIx · statistical release · weights derived from DGCA domestic traffic share · validated
          against the MoSPI transport sub-index proxy · fare corpus is a deterministic simulation of
          the scrape pipeline for demonstration.
        </p>
      </footer>
    </div>
  );
}

function HeatGrid({ data }: { data: Dataset }) {
  const periods = data.heat.periods;
  const byKey = new Map(data.heat.cells.map((c) => [`${c.routeId}|${c.period}`, c]));

  return (
    <div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `auto repeat(${periods.length}, minmax(0,1fr))` }}
      >
        <span />
        {periods.map((p, i) => (
          <span key={p} className="num text-center text-[8px] text-faint">
            W{i + 1}
          </span>
        ))}
        {ROUTES.map((r) => (
          <FragmentRow key={r.id} routeId={r.id} periods={periods} byKey={byKey} />
        ))}
      </div>
      <div className="num mt-3 flex items-center gap-2 text-[9px] text-faint">
        <span>COOL</span>
        <span
          className="h-1.5 flex-1 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklab, var(--color-primary) 15%, transparent), color-mix(in oklab, var(--color-primary) 70%, transparent), color-mix(in oklab, var(--color-warn) 75%, transparent))",
          }}
        />
        <span>SURGE</span>
      </div>
    </div>
  );
}

function FragmentRow({
  routeId,
  periods,
  byKey,
}: {
  routeId: string;
  periods: string[];
  byKey: Map<string, { value: number; z: number }>;
}) {
  return (
    <>
      <span className="num pr-1 text-[9px] text-muted-foreground">{routeId}</span>
      {periods.map((p) => {
        const cell = byKey.get(`${routeId}|${p}`);
        const z = cell?.z ?? 0;
        const intensity = Math.min(1, Math.max(0.12, (z + 2) / 4));
        const hot = z > 1.2;
        return (
          <span
            key={p}
            title={cell ? `${routeId} ${p} · ₹${cell.value.toLocaleString("en-IN")} · z=${z.toFixed(2)}` : "no data"}
            className="h-5 rounded-sm"
            style={{
              background: `color-mix(in oklab, ${hot ? "var(--color-warn)" : "var(--color-primary)"} ${(intensity * 70).toFixed(0)}%, transparent)`,
            }}
          />
        );
      })}
    </>
  );
}
