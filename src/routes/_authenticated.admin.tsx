import { createFileRoute, redirect } from "@tanstack/react-router";
import { roleHome } from "@/lib/auth/types";

export const Route = createFileRoute("/_authenticated/admin")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "ADMIN") {
      throw redirect({ to: roleHome(context.user.role) });
    }
  },
});
