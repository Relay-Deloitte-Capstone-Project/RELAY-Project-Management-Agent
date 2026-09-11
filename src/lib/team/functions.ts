import { createServerFn } from "@tanstack/react-start";
import { prisma } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

// Non-sensitive roster info (name/role/initials/color) — any logged-in
// user can see who's on the team, unlike listAppUsers (email/status/
// lastSeen), which is admin-only.
export const listTeamRoster = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, initials: true, avatarColor: true },
    });
    return users;
  });
