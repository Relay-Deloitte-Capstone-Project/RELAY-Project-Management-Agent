import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/functions";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    const user = await getSessionUser();
    if (!user) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
    return { user };
  },
  // No component — defaults to <Outlet />. The visual shell (sidebar,
  // topbar) is still rendered per-page via <AppShell>, not here.
});
