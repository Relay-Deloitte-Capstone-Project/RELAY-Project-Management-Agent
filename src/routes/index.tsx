import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutGrid, MessageSquare, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { currentUser, project } from "@/lib/mockData";
import { ThemeToggle, useDarkMode } from "@/components/relay/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Relay — Project memory for engineering teams" },
      {
        name: "description",
        content:
          "Relay keeps project knowledge when people leave: handover briefs, cited Q&A, scope guardian and honest coverage metrics.",
      },
      { property: "og:title", content: "Relay — Project memory for engineering teams" },
      {
        property: "og:description",
        content:
          "A time-aware workspace for developers, managers and admins: handover briefs, cited answers, scope alerts and coverage honesty.",
      },
    ],
  }),
  component: Landing,
});

type Period = "dawn" | "day" | "evening" | "night";

const COPY: Record<Period, { label: string; greeting: string; subtext: string }> = {
  dawn: {
    label: "Good morning",
    greeting: `Rise and shine, ${currentUser.firstName}.`,
    subtext: "Your day is starting. Here's what's waiting.",
  },
  day: {
    label: "Good afternoon",
    greeting: `Sunshine, ${currentUser.firstName}.`,
    subtext: `You have ${currentUser.openTickets} open tickets, ${currentUser.openPRs} open PRs, and ${currentUser.pendingReviews} reviews waiting. Here's where things stand.`,
  },
  evening: {
    label: "Good evening",
    greeting: `Winding down, ${currentUser.firstName}.`,
    subtext: "3 things unfinished today. Your scratchpad has a draft note.",
  },
  night: {
    label: "Late night",
    greeting: `Late night, ${currentUser.firstName}.`,
    subtext: "Don't forget to rest. You can leave a note — it'll be here tomorrow.",
  },
};

function periodForHour(hour: number): Period {
  if (hour >= 5 && hour <= 8) return "dawn";
  if (hour >= 9 && hour <= 16) return "day";
  if (hour >= 17 && hour <= 19) return "evening";
  return "night";
}

const TINT: Record<Period, string> = {
  dawn: "bg-[rgba(255,210,120,0.06)]",
  day: "bg-transparent",
  evening: "bg-[rgba(200,100,40,0.06)]",
  night: "bg-transparent",
};

const CARDS = [
  {
    to: "/dev/work",
    icon: <LayoutGrid />,
    tone: "bg-brand-soft text-brand",
    title: "My work",
    meta: "7 open · 2 critical",
  },
  {
    to: "/dev/ask",
    icon: <MessageSquare />,
    tone: "bg-success-soft text-success",
    title: "Ask the project",
    meta: "1,247 tickets indexed",
  },
  {
    to: "/dev/scratchpad",
    icon: <Pencil />,
    tone: "bg-warning-soft text-warning",
    title: "Scratchpad",
    meta: "1 draft awaiting you",
  },
] as const;

function Landing() {
  const { dark, toggle, setMode } = useDarkMode();
  const [period, setPeriod] = useState<Period>("day");
  const [clock, setClock] = useState("");

  useEffect(() => {
    const now = new Date();
    const p = periodForHour(now.getHours());
    setPeriod(p);
    if (p === "night") setMode(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(
        `${now.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })} · ${now.toLocaleDateString("en-US", {
          weekday: "short",
          day: "numeric",
          month: "short",
        })}`,
      );
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const copy = COPY[period];

  const simulate = (p: Period) => {
    setPeriod(p);
    setMode(p === "night");
  };

  return (
    <div className="relative flex min-h-screen min-w-[1024px] flex-col overflow-hidden bg-background">
      <div className={cn("pointer-events-none absolute inset-0", TINT[period])} />

      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 -right-5 -translate-y-1/2 font-serif leading-none text-brand opacity-5 select-none"
        style={{ fontSize: "clamp(200px, 30vw, 320px)" }}
      >
        R
      </span>

      <div className="relative z-10 flex items-center justify-between px-8 pt-6">
        <span className="font-mono text-[13px] tracking-[3px] text-ink uppercase">
          Relay
          <span className="ml-1.5 inline-block size-1.5 rounded-full bg-brand align-middle" />
        </span>
        <div className="flex items-center gap-3">
          <span className="text-[10px] tracking-wide text-mute uppercase">Simulate:</span>
          <div className="flex overflow-hidden rounded-md border border-border">
            {(["dawn", "day", "evening", "night"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => simulate(p)}
                className={cn(
                  "px-2.5 py-1 text-[11px] font-medium capitalize transition-colors duration-150",
                  p === period
                    ? "bg-brand text-brand-foreground"
                    : "text-mute hover:bg-surface-sunken hover:text-ink",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <ThemeToggle dark={dark} toggle={toggle} />
        </div>
      </div>

      <div className="relative z-10 flex flex-grow items-center px-8">
        <div className="w-[55%]">
          <div className="text-[10px] font-semibold tracking-[2.5px] text-mute uppercase">
            {copy.label}
          </div>
          <h1 className="mt-3 font-serif text-[52px] leading-[1.05] font-normal tracking-[-1.5px] text-ink">
            {copy.greeting}
          </h1>
          <p className="mt-4 max-w-[380px] text-[13px] leading-[1.7] text-mute">
            {copy.subtext}
          </p>

          <div className="mt-8 flex gap-2.5">
            {CARDS.map((card) => (
              <Link
                key={card.to}
                to={card.to}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 transition-all duration-150 hover:-translate-y-px hover:border-brand"
              >
                <span
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-md [&_svg]:size-3.5",
                    card.tone,
                  )}
                >
                  {card.icon}
                </span>
                <span>
                  <span className="block text-[12px] font-semibold text-ink">
                    {card.title}
                  </span>
                  <span className="block text-[10px] text-mute">{card.meta}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="relative z-10 flex h-12 items-center justify-between border-t border-border px-8">
        <div className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-[11px] text-mute">{clock}</span>
        </div>
        <span className="text-[10px] tracking-wide text-mute uppercase">
          {project.name} · {project.engagement}
        </span>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold text-brand">
          Developer
        </span>
      </div>
    </div>
  );
}
