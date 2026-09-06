import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronDown, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { project } from "@/lib/mockData";
import { periodConfig, useTimePeriod, type Period } from "@/hooks/useTimePeriod";
import { AmbientIcons } from "@/components/relay/AmbientIcons";
import { getSessionUser } from "@/lib/auth/functions";
import { roleHome } from "@/lib/auth/types";

export const Route = createFileRoute("/")({
  loader: () => getSessionUser(),
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

const SUBTEXT: Record<Period, string> = {
  dawn: "Your day is starting. Here's what's waiting.",
  day: "You have open tickets, open PRs, and reviews waiting. Here's where things stand.",
  evening: "A few things unfinished today. Your scratchpad has a draft note.",
  night: "Don't forget to rest. You can leave a note — it'll be here tomorrow.",
};

function Landing() {
  const period = useTimePeriod();
  const config = periodConfig[period];
  const user = Route.useLoaderData();
  const navigate = useNavigate();
  const [clock, setClock] = useState("");
  const [entered, setEntered] = useState(false);
  const hasEntered = useRef(false);

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

  const handleEnter = () => {
    if (hasEntered.current) return;
    hasEntered.current = true;
    setEntered(true);
    const dest = user ? roleHome(user.role) : "/login";
    window.setTimeout(() => navigate({ to: dest }), 400);
  };

  return (
    <div className={cn("landing-wrapper", entered && "landing-exit")} onWheel={handleEnter}>
      <div
        data-land-period={period}
        className="landing relative flex min-h-screen min-w-[1024px] flex-col overflow-hidden bg-[var(--land-bg)] transition-colors duration-500"
      >
        <AmbientIcons period={period} />

        <div className="relative z-10 flex items-center justify-between px-8 pt-6">
          <span className="font-mono text-[13px] tracking-[3px] text-[var(--land-text)] uppercase">
            Relay
            <span
              className="ml-1.5 inline-block size-1.5 rounded-full align-middle"
              style={{ background: "var(--land-accent)" }}
            />
          </span>
          <span
            aria-hidden
            className="inline-flex size-7 items-center justify-center rounded-md border"
            style={{ borderColor: "var(--land-mute)", color: "var(--land-mute)" }}
            title="Theme follows the time of day"
          >
            {config.isDark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
          </span>
        </div>

        <div className="relative z-10 flex flex-grow items-center px-8">
          <div className="w-[55%]">
            <div
              className="text-[11px] font-semibold tracking-[2.5px] uppercase"
              style={{ color: "var(--land-mute)" }}
            >
              {config.label}
            </div>
            <h1 className="mt-3 font-serif text-[58px] leading-[1.05] font-normal tracking-[-1.5px] text-[var(--land-text)]">
              {config.greeting}
              {user ? `, ${user.name.split(" ")[0]}` : ""}.
            </h1>
            <p
              className="mt-4 max-w-[380px] text-[13px] leading-[1.7]"
              style={{ color: "var(--land-mute)" }}
            >
              {SUBTEXT[period]}
            </p>

            <div className="scroll-prompt" onClick={handleEnter}>
              <p className="scroll-label">{user ? "Scroll to enter" : "Scroll to sign in"}</p>
              <div className="scroll-arrow">
                <ChevronDown size={20} />
              </div>
            </div>
          </div>
        </div>

        <div
          className="relative z-10 flex h-12 items-center justify-between border-t px-8"
          style={{ borderColor: "var(--land-mute)", opacity: 0.9 }}
        >
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-success" />
            <span className="text-[11px]" style={{ color: "var(--land-mute)" }}>
              {clock}
            </span>
          </div>
          <span
            className="text-[11px] tracking-wide uppercase"
            style={{ color: "var(--land-mute)" }}
          >
            {project.name} · {project.engagement}
          </span>
          <span />
        </div>
      </div>
    </div>
  );
}
