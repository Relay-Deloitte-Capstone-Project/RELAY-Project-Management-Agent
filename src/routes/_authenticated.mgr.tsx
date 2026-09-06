import { createFileRoute, redirect } from "@tanstack/react-router";
import { roleHome } from "@/lib/auth/types";

export const Route = createFileRoute("/_authenticated/mgr")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "MANAGER") {
      throw redirect({ to: roleHome(context.user.role) });
    }
  },
});
