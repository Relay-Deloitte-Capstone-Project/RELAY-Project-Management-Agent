import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginForm } from "@/components/relay/LoginForm";
import { getSessionUser } from "@/lib/auth/functions";
import { roleHome } from "@/lib/auth/types";
import { useTimePeriod } from "@/hooks/useTimePeriod";

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

  return (
    <div
      data-land-period={period}
      className="landing relative flex min-h-screen min-w-[1024px] items-center justify-center overflow-hidden bg-[var(--land-bg)] transition-colors duration-500"
    >
      <div className="relative z-10">
        <LoginForm redirectTo={redirectTo} />
      </div>
    </div>
  );
}
