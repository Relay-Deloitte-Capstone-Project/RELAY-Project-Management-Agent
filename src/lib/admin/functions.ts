import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { signApiToken } from "@/lib/auth/session.server";
import { isRole } from "@/lib/auth/types";

const ACTIVE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30; // a session created in the last 30 days reads as "Active"

// Same palette style as the seeded users (prisma/seed.ts) — cycled by
// however many users already exist so a freshly invited person gets a
// distinct-looking color instead of everyone landing on the same default.
const AVATAR_COLORS = [
  "#FEF3C7",
  "#F3F0FF",
  "#E8EAFF",
  "#DCFCE7",
  "#E0F2FE",
  "#ECFDF5",
  "#FDE8FF",
  "#FFF7ED",
  "#FEE2E2",
  "#E0E7FF",
];

// The FastAPI backend (backend/main.py) — same one every other real-data
// page on this app calls. Project membership (public.project_staffing) lives
// in that backend's Postgres, not in this app's Prisma/SQLite — this is the
// only way the Node side can find out which real project(s) a person is on.
const API_URL = process.env["VITE_ASK_API_URL"] ?? "http://127.0.0.1:8001";

type MyProjectRow = { name: string };

// This runs server-side, inside listAppUsers's own handler — never through
// relayFetch/getAskApiToken, which mint and cache a token per BROWSER tab.
// A Node server process handles many different admins' requests over its
// lifetime; sharing that browser-oriented cache here would risk one admin's
// request reusing a token minted for a completely different admin. The
// caller already has a verified identity (context.user, from this same
// file's own authMiddleware) — mint directly from that instead, once per
// listAppUsers call, and pass it in.
//
// Also deliberately calls /api/admin/user-projects, not /api/me/projects:
// that endpoint now only ever returns the CALLER's own projects (a
// necessary fix — it used to let anyone look up anyone else's projects by
// email), which broke this specific admin-only "look up an arbitrary
// other user's projects" case. /api/admin/user-projects is the ADMIN-gated
// replacement for exactly that.
async function projectNamesFor(email: string, apiToken: string): Promise<string> {
  try {
    const res = await fetch(`${API_URL}/api/admin/user-projects?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return "—";
    const rows: MyProjectRow[] = await res.json();
    if (rows.length === 0) return "—";
    return rows.map((r) => r.name).join(", ");
  } catch {
    // Backend unreachable — this column just reads "—" rather than blocking
    // the whole user list.
    return "—";
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "??";
}

function randomTempPassword(): string {
  // 12 chars from an unambiguous alphabet (no 0/O/1/l) — shown once to the
  // admin, never stored in plaintext.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)] ?? "x";
  }
  return out;
}

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
    const apiToken = signApiToken(context.user);
    const projectNames = await Promise.all(users.map((u) => projectNamesFor(u.email, apiToken)));

    return users.map((u, i) => {
      const lastSession = u.sessions[0];
      const lastSeen = lastSession?.createdAt ?? u.createdAt;
      const isActive = now - lastSeen.getTime() < ACTIVE_WINDOW_MS;
      return {
        name: u.name,
        initials: u.initials,
        email: u.email,
        role: u.role,
        project: projectNames[i] ?? "—",
        status: isActive ? "Active" : "Inactive",
        lastSeen: lastSeen.toISOString(),
      };
    });
  });

export const createAppUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(1, "Name is required"),
      email: z.string().trim().toLowerCase().email("Enter a valid email address"),
      role: z.string().refine(isRole, "Invalid role"),
    }),
  )
  .handler(async ({ context, data }) => {
    if (context.user.role !== "ADMIN") {
      throw new Error("Forbidden");
    }

    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      throw new Error("A user with this email already exists");
    }

    const userCount = await prisma.user.count();
    const avatarColor = AVATAR_COLORS[userCount % AVATAR_COLORS.length] ?? "#E8EAFF";
    const tempPassword = randomTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const created = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        initials: initialsOf(data.name),
        avatarColor,
        passwordHash,
      },
    });

    return {
      user: {
        name: created.name,
        initials: created.initials,
        email: created.email,
        role: created.role,
        project: "—",
        status: "Active",
        lastSeen: created.createdAt.toISOString(),
      },
      tempPassword,
    };
  });
