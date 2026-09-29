import type { ReactNode } from "react";

export function Panel({
  title,
  caption,
  aside,
  children,
  id,
  className = "",
}: {
  title?: string;
  caption?: string;
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`frost rounded-xl p-5 scroll-mt-24 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && (
              <h2 className="font-display text-base font-semibold text-card-foreground">{title}</h2>
            )}
            {caption && (
              <p className="num mt-0.5 text-[10px] uppercase tracking-[0.12em] text-faint">
                {caption}
              </p>
            )}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "warn" }) {
  const toneClass =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "warn"
          ? "text-warn"
          : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="num text-[10px] text-faint">{label}</span>
      <span className={`num text-[11px] ${toneClass}`}>{value}</span>
    </div>
  );
}
