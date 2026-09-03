import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("section-label mb-1.5", className)}>{children}</div>;
}

export function PageSection({
  label,
  subtitle,
  children,
  className,
}: {
  label?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mb-6", className)}>
      {label ? <SectionLabel>{label}</SectionLabel> : null}
      {subtitle ? (
        <p className="mb-3 text-[12px] leading-relaxed text-mute">{subtitle}</p>
      ) : null}
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
        "rounded-2xl border border-border bg-card p-4 transition-colors duration-150 hover:border-brand",
        className,
      )}
    >
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
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
        "inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap",
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
  return <span className="font-mono text-[11px] text-mute">{children}</span>;
}

export function MetricCard({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-surface-sunken px-4 py-3">
      <div className="section-label">{label}</div>
      <div className={cn("mt-1 text-[24px] font-semibold", toneText[tone])}>{value}</div>
      {hint ? <div className="mt-0.5 text-[10px] text-mute">{hint}</div> : null}
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
    <div className="rounded-lg bg-surface-sunken px-4 py-3">
      <div className="section-label">{label}</div>
      <div className="mt-1.5 flex items-center gap-2">
        <span
          className={cn(
            "size-1.5 rounded-full",
            tone === "success" ? "bg-success" : "bg-warning",
          )}
        />
        <span className="text-[13px] font-medium text-ink">{value}</span>
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
        <span className="w-[110px] shrink-0 text-[11px] text-mute">{label}</span>
        <span className="h-1 flex-grow overflow-hidden rounded-full bg-surface-sunken">
          <span
            className={cn("block h-full rounded-full transition-all duration-700", toneFill[t])}
            style={{ width: `${value}%` }}
          />
        </span>
        <span className={cn("w-8 text-right text-[11px] font-semibold", toneText[t])}>
          {value}%
        </span>
      </div>
    );
  }
  return (
    <div>
      <div className="section-label mb-1">{label}</div>
      <div className={cn("mb-1 text-[13px] font-semibold", toneText[t])}>{value}%</div>
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
      <h3 className="mt-3 text-[14px] font-medium text-ink">Nothing here yet.</h3>
      <p className="mt-1 max-w-[280px] text-[12px] text-mute">{body}</p>
      {cta ? <div className="mt-3">{cta}</div> : null}
    </div>
  );
}

export function GhostButton({
  children,
  tone = "neutral",
  onClick,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  onClick?: () => void;
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all duration-100 active:scale-[0.98] [&_svg]:size-3",
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
  return <p className="text-[10px] text-mute italic">{children}</p>;
}
