import { createFileRoute, redirect } from "@tanstack/react-router";
import { roleHome } from "@/lib/auth/types";

export const Route = createFileRoute("/_authenticated/dev")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "DEVELOPER") {
      throw redirect({ to: roleHome(context.user.role) });
    }
  },
});
