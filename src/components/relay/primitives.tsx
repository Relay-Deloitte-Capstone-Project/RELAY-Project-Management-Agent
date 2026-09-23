import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("section-label mb-1.5", className)}>{children}</div>;
}

export function PageSection({
  id,
  label,
  subtitle,
  children,
  className,
}: {
  id?: string;
  label?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("mb-6", className)}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      {subtitle ? <p className="mb-3 text-[13px] leading-relaxed text-mute">{subtitle}</p> : null}
      {children}
    </section>
  );
}

export function Panel({
  title,
  icon,
  action,
  children,
  className,
}: {
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow-card)] transition-colors duration-150 hover:border-border-strong",
        className,
      )}
    >
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            {icon}
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

type Tone = "brand" | "success" | "warning" | "danger" | "neutral" | "violet";

const toneText: Record<Tone, string> = {
  brand: "text-brand",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-mute",
  violet: "text-brand",
};

const toneBadge: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-sunken text-mute",
  violet: "bg-violet-soft text-brand",
};

export function Chip({
  children,
  tone = "neutral",
  round = false,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  round?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        round ? "rounded-full px-2" : "rounded-sm",
        toneBadge[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function TicketKey({ children }: { children: ReactNode }) {
  return <span className="ticket-key shrink-0 tracking-normal">{children}</span>;
}

export function BranchName({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] text-mute">{children}</span>;
}

export function MetricCard({
  label,
  value,
  tone = "neutral",
  hint,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
  /* Inverts the card to the ink surface, marking the single headline figure on
     a screen. Use at most once per view or it stops meaning anything. */
  emphasis?: boolean;
}) {
  return (
    <div className={cn("rounded-xl px-4 py-3.5", emphasis ? "bg-brand" : "bg-surface-sunken")}>
      <div className={cn("section-label", emphasis && "!text-brand-foreground/70")}>{label}</div>
      <div
        className={cn(
          "mt-1 text-[28px] font-semibold tracking-tight tabular-nums",
          emphasis ? "text-brand-foreground" : tone === "neutral" ? "text-ink" : toneText[tone],
        )}
      >
        {value}
      </div>
      {hint ? (
        <div
          className={cn("mt-0.5 text-[11px]", emphasis ? "text-brand-foreground/70" : "text-mute")}
        >
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function StatusDotCard({
  label,
  value,
  tone = "success",
}: {
  label: string;
  value: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-xl bg-surface-sunken px-4 py-3.5">
      <div className="section-label">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <span
          className={cn("size-1.5 rounded-full", tone === "success" ? "bg-success" : "bg-warning")}
        />
        <span className="text-[14px] font-semibold text-ink">{value}</span>
      </div>
    </div>
  );
}

export function toneForPercent(pct: number): Tone {
  if (pct > 70) return "success";
  if (pct >= 40) return "warning";
  return "danger";
}

const toneFill: Record<Tone, string> = {
  brand: "bg-brand",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-mute",
  violet: "bg-brand",
};

export function ProgressRow({
  label,
  value,
  tone,
  inline = false,
}: {
  label: string;
  value: number;
  tone?: Tone;
  inline?: boolean;
}) {
  const t = tone ?? toneForPercent(value);
  if (inline) {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="w-[110px] shrink-0 text-[13px] text-mute">{label}</span>
        <span className="h-1 flex-grow overflow-hidden rounded-full bg-surface-sunken">
          <span
            className={cn("block h-full rounded-full transition-all duration-700", toneFill[t])}
            style={{ width: `${value}%` }}
          />
        </span>
        <span className={cn("w-8 text-right text-[13px] font-semibold", toneText[t])}>
          {value}%
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="section-label mb-1">{label}</div>
      <div className={cn("mb-1 text-[14px] font-semibold", toneText[t])}>{value}%</div>
      <div className="h-[5px] overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full transition-all duration-700", toneFill[t])}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  body,
  cta,
}: {
  icon: ReactNode;
  body: string;
  cta?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <div className="text-mute [&_svg]:size-10">{icon}</div>
      <h3 className="mt-3 text-[15px] font-semibold text-ink">Nothing here yet.</h3>
      <p className="mt-1 max-w-[280px] text-[13px] text-mute">{body}</p>
      {cta ? <div className="mt-3">{cta}</div> : null}
    </div>
  );
}

export function GhostButton({
  children,
  tone = "neutral",
  onClick,
  disabled,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    brand: "border-brand text-brand hover:bg-brand-soft",
    success: "border-success text-success hover:bg-success-soft",
    warning: "border-warning text-warning hover:bg-warning-soft",
    danger: "border-danger text-danger hover:bg-danger-soft",
    neutral: "border-transparent text-mute hover:bg-surface-sunken",
    violet: "border-brand text-brand hover:bg-brand-soft",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all duration-100 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3",
        border[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Avatar({
  initials,
  tone = "brand",
  size = 32,
}: {
  initials: string;
  tone?: Tone;
  size?: number;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
        toneBadge[tone],
      )}
      style={{ width: size, height: size }}
    >
      {initials}
    </span>
  );
}

export function LegalNote({ children }: { children: ReactNode }) {
  return <p className="text-[11px] text-mute italic">{children}</p>;
}

/* Loading placeholders. These mirror the shape of the content that replaces
   them, so a slow response reads as "arriving" rather than "stuck" — the same
   wait feels considerably shorter than it does behind a spinner. */

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-grow space-y-1.5">
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonMetrics({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("grid grid-cols-4 gap-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl bg-surface-sunken px-4 py-3.5">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="mt-2.5 h-7 w-12" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({ lines = 4, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5", className)}>
      <Skeleton className="mb-4 h-3 w-32" />
      <SkeletonText lines={lines} />
    </div>
  );
}
