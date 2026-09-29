import { useId, useMemo, useState } from "react";

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

export function LineChart({
  labels,
  series,
  height = 190,
  valueFormat = (v: number) => v.toFixed(2),
}: {
  labels: string[];
  series: Series[];
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
    if (all.length === 0) return { min: 0, max: 1 };
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const pad = (hi - lo || 1) * 0.15;
    return { min: lo - pad, max: hi + pad };
  }, [series]);

  const w = 1000;
  const h = 320;
  const padL = 46;
  const padB = 26;
  const padT = 10;

  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - 8));
  const y = (v: number) => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));

  return (
    <div className="relative" style={{ height }}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - rect.left) / rect.width;
          const svgX = rel * w;
          const idx = Math.round(((svgX - padL) / (w - padL - 8)) * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, idx)));
        }}
      >
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={w - 8}
              y1={y(t)}
              y2={y(t)}
              stroke="var(--color-line)"
              strokeWidth="1"
              opacity="0.55"
            />
            <text
              x={padL - 8}
              y={y(t) + 4}
              textAnchor="end"
              className="num"
              fontSize="11"
              fill="var(--color-faint)"
            >
              {valueFormat(t)}
            </text>
          </g>
        ))}

        {series.map((s) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(" L ");
          const area = `M ${x(0)},${y(min)} L ${pts} L ${x(s.values.length - 1)},${y(min)} Z`;
          return (
            <g key={s.key}>
              {!s.dashed && <path d={area} fill={`url(#${uid}-${s.key})`} />}
              <path
                d={`M ${pts}`}
                fill="none"
                stroke={s.color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeDasharray={s.dashed ? "7 6" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hover != null && (
          <g>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={padT}
              y2={h - padB}
              stroke="var(--color-primary)"
              strokeWidth="1"
              opacity="0.6"
            />
            {series.map((s) =>
              Number.isFinite(s.values[hover]) ? (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(s.values[hover] ?? 0)}
                  r="4"
                  fill="var(--color-background)"
                  stroke={s.color}
                  strokeWidth="2.5"
                />
              ) : null,
            )}
          </g>
        )}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border border-line bg-popover/95 px-2.5 py-1.5 shadow-lg backdrop-blur"
          style={{
            left: `calc(${((hover / Math.max(1, n - 1)) * 100).toFixed(2)}% )`,
            transform: hover > n / 2 ? "translateX(-108%)" : "translateX(8%)",
          }}
        >
          <p className="num text-[10px] text-faint">{labels[hover]}</p>
          {series.map((s) => (
            <p key={s.key} className="num text-[11px]" style={{ color: s.color }}>
              {s.label} {valueFormat(s.values[hover] ?? 0)}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
