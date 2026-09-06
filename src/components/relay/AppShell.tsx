import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  Database,
  LayoutGrid,
  Lock,
  MessageSquare,
  Moon,
  Pencil,
  Settings,
  Shield,
  Sun,
  Sunrise,
  Sunset,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { project } from "@/lib/mockData";
import { periodConfig, useTimePeriod, type Period } from "@/hooks/useTimePeriod";
import type { Role, SessionUser } from "@/lib/auth/types";
import { SignOutButton } from "./SignOutButton";

type NavItem = { to: string; label: string; icon: ReactNode };
type NavGroup = { label: string; items: NavItem[] };

const NAV: Record<Role, NavGroup[]> = {
  DEVELOPER: [
    {
      label: "My workspace",
      items: [
        { to: "/dev/work", label: "My work", icon: <LayoutGrid /> },
        { to: "/dev/ask", label: "Ask project", icon: <MessageSquare /> },
        { to: "/dev/scratchpad", label: "Scratchpad", icon: <Pencil /> },
      ],
    },
    {
      label: "Project",
      items: [
        { to: "/dev/coverage", label: "Coverage", icon: <BarChart3 /> },
        { to: "/dev/epics", label: "Epics", icon: <Boxes /> },
      ],
    },
  ],
  MANAGER: [
    {
      label: "Overview",
      items: [
        { to: "/mgr/dashboard", label: "Dashboard", icon: <BarChart3 /> },
        { to: "/mgr/team", label: "Team handover", icon: <Users /> },
        { to: "/mgr/scope", label: "Scope guardian", icon: <Shield /> },
        { to: "/mgr/epics", label: "Epic progress", icon: <Boxes /> },
      ],
    },
    {
      label: "Controls",
      items: [{ to: "/mgr/admin", label: "Access control", icon: <Lock /> }],
    },
  ],
  ADMIN: [
    {
      label: "System",
      items: [
        { to: "/admin/dashboard", label: "System health", icon: <BarChart3 /> },
        { to: "/admin/users", label: "All users", icon: <Users /> },
        { to: "/admin/ingestion", label: "Ingestion logs", icon: <Database /> },
        { to: "/admin/config", label: "Configuration", icon: <Settings /> },
      ],
    },
  ],
};

export function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem("relay-theme");
    const isDark = stored === "dark";
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const toggle = () => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      window.localStorage.setItem("relay-theme", next ? "dark" : "light");
      return next;
    });
  };

  const setMode = (isDark: boolean) => {
    setDark(isDark);
    document.documentElement.classList.toggle("dark", isDark);
    window.localStorage.setItem("relay-theme", isDark ? "dark" : "light");
  };

  return { dark, toggle, setMode };
}

export function ThemeToggle({ dark, toggle }: { dark: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="inline-flex size-7 items-center justify-center rounded-md border border-border text-mute transition-colors duration-150 hover:text-ink [&_svg]:size-3.5"
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}

const PERIOD_ICON: Record<Period, typeof Sunrise> = {
  dawn: Sunrise,
  day: Sun,
  evening: Sunset,
  night: Moon,
};

function PeriodChip({ period }: { period: Period }) {
  const config = periodConfig[period];
  const Icon = PERIOD_ICON[period];
  return (
    <div className="period-chip" style={{ background: config.accentSoft, color: config.accent }}>
      <Icon size={13} />
      <span>{config.label}</span>
    </div>
  );
}

function Sidebar({ role }: { role: Role }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <Link to="/" className="block px-5 pt-6 pb-6">
        <span className="font-mono text-[13px] tracking-[3px] text-sidebar-foreground uppercase">
          Relay
        </span>
        <span
          className="ml-1.5 inline-block size-1.5 rounded-full align-middle"
          style={{ background: "var(--period-accent)" }}
        />
      </Link>

      <nav className="flex-grow px-3">
        {NAV[role].map((group) => (
          <div key={group.label} className="mb-5">
            <div className="mb-1.5 px-2 text-[11px] font-semibold tracking-[0.05em] text-sidebar-muted uppercase">
              {group.label}
            </div>
            {group.items.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex h-9 items-center gap-2.5 rounded-md border-l-2 border-l-transparent px-2 text-[13px] font-medium text-sidebar-muted transition-colors duration-150 hover:bg-sidebar-active hover:text-sidebar-foreground [&_svg]:size-3.5"
                activeProps={{
                  className:
                    "bg-sidebar-active !text-[var(--period-accent)] !border-l-[var(--period-accent)]",
                }}
              >
                {item.icon}
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border py-2">
        <SignOutButton />
      </div>

      <div className="border-t border-sidebar-border px-5 py-4">
        <div className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-[13px] font-medium text-sidebar-foreground">{project.name}</span>
        </div>
        <div className="mt-1 text-[11px] text-sidebar-muted">
          {project.tickets.toLocaleString()} tickets · {project.commits} commits
        </div>
      </div>
    </aside>
  );
}

export function AppShell({
  user,
  title,
  children,
  padded = true,
}: {
  user: SessionUser;
  title: string;
  children: ReactNode;
  padded?: boolean;
}) {
  const { dark, toggle } = useDarkMode();
  const period = useTimePeriod();

  return (
    <div className="flex h-screen min-w-[1024px] overflow-hidden bg-background">
      <Sidebar role={user.role} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-6">
          <h1 className="text-[15px] font-semibold text-ink">{title}</h1>
          <div className="flex items-center gap-3">
            <PeriodChip period={period} />
            <ThemeToggle dark={dark} toggle={toggle} />
            <div
              className="flex items-center gap-2 rounded-full border border-border py-1 pr-2.5 pl-1"
              style={{ fontSize: 12, fontWeight: 500 }}
            >
              <span
                className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-ink"
                style={{ width: 26, height: 26, background: user.avatarColor }}
              >
                {user.initials}
              </span>
              <span className="text-ink">{user.name}</span>
            </div>
          </div>
        </header>
        <div
          className={cn(
            "min-h-0 flex-1",
            padded ? "overflow-y-auto p-6" : "flex flex-col overflow-hidden",
          )}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

export const RiskIcon = TriangleAlert;
