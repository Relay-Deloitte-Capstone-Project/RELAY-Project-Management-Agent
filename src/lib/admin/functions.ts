import { createServerFn } from "@tanstack/react-start";
import { prisma } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";

// This app has one real engagement today — no multi-project concept exists
// in Prisma's schema, so "projects" can't be a real per-user count. Shown
// as the one real engagement name instead of a fabricated number.
const ENGAGEMENT_NAME = "Relay-Deloitte Capstone";

const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30; // a session created in the last 30 days reads as "Active"

export const listAppUsers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (context.user.role !== "ADMIN") {
      throw new Error("Forbidden");
    }

    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      include: {
        sessions: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    const now = Date.now();
    return users.map((u) => {
      const lastSession = u.sessions[0];
      const lastSeen = lastSession?.createdAt ?? u.createdAt;
      const isActive = now - lastSeen.getTime() < ACTIVE_WINDOW_MS;
      return {
        name: u.name,
        initials: u.initials,
        email: u.email,
        role: u.role,
        project: ENGAGEMENT_NAME,
        status: isActive ? "Active" : "Inactive",
        lastSeen: lastSeen.toISOString(),
      };
    });
  });
