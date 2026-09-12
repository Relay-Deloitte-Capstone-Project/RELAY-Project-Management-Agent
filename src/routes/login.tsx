import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LoginForm } from "@/components/relay/LoginForm";
import { getSessionUser } from "@/lib/auth/functions";
import { roleHome } from "@/lib/auth/types";
import { useTimePeriod } from "@/hooks/useTimePeriod";

const API_URL = import.meta.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

function sanitizeRedirect(url: unknown): string | null {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return null;
  return url;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => {
    const target = sanitizeRedirect(search["redirect"]);
    return target ? { redirect: target } : {};
  },
  beforeLoad: async ({ search }) => {
    const user = await getSessionUser();
    if (user) throw redirect({ to: search.redirect || roleHome(user.role) });
  },
  head: () => ({
    meta: [
      { title: "Sign in — Relay" },
      { name: "description", content: "Sign in to Relay with your team credentials." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const period = useTimePeriod();
  const { redirect: redirectTo } = Route.useSearch();
  const [waking, setWaking] = useState(false);

  // The Render free-tier backend sleeps after ~15 min idle. Ping it the
  // moment the login page opens so the cold start overlaps with the user
  // typing their credentials; keep retrying until it answers.
  useEffect(() => {
    let cancelled = false;
    const slow = window.setTimeout(() => !cancelled && setWaking(true), 2000);
    const ping = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${API_URL}/health`);
          if (res.ok) break;
        } catch {
          // not awake yet — retry below
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (!cancelled) {
        window.clearTimeout(slow);
        setWaking(false);
      }
    };
    void ping();
    return () => {
      cancelled = true;
      window.clearTimeout(slow);
    };
  }, []);

  return (
    <div
      data-land-period={period}
      className="landing relative flex min-h-screen min-w-[1024px] items-center justify-center overflow-hidden bg-[var(--land-bg)] transition-colors duration-500"
    >
      <div className="relative z-10">
        <LoginForm redirectTo={redirectTo} />
        {waking && (
          <p className="mt-4 animate-pulse text-center text-xs text-[var(--land-fg)]/60">
            Waking up the server — first load can take a minute…
          </p>
        )}
      </div>
    </div>
  );
}
