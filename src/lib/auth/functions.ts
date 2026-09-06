import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import {
  clearSessionCookie,
  readSessionToken,
  setSessionCookie,
  signToken,
  verifyToken,
} from "@/lib/auth/session.server";
import { isRole, type SessionUser } from "@/lib/auth/types";
import { authMiddleware } from "./middleware";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

// Constant-cost placeholder so "user not found" and "wrong password" take
// the same time — otherwise timing reveals which emails are registered.
let dummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  dummyHash ??= await bcrypt.hash("relay-timing-safe-placeholder", 12);
  return dummyHash;
}

export const login = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.string().email(), password: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
    });

    const hashToCheck = user?.passwordHash ?? (await getDummyHash());
    const passwordMatches = await bcrypt.compare(data.password, hashToCheck);

    if (!user || !passwordMatches || !isRole(user.role)) {
      throw new Error("Invalid email or password");
    }

    const payload: SessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      initials: user.initials,
      avatarColor: user.avatarColor,
    };

    // Rotate: drop any stale sessions for this user, then issue one fresh
    // token backed by a fresh DB row (so logout can actually revoke it).
    await prisma.session.deleteMany({ where: { userId: user.id } });
    const token = signToken(payload);
    await prisma.session.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    setSessionCookie(token);

    return { user: payload };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const token = readSessionToken();
  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }
  clearSessionCookie();
  return { ok: true };
});

export const getSessionUser = createServerFn({ method: "GET" }).handler(async () => {
  const token = readSessionToken();
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;

  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) return null;

  return payload;
});

export const listUsers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    if (context.user.role !== "ADMIN") throw new Error("Forbidden");
    const users = await prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        initials: true,
        avatarColor: true,
        createdAt: true,
      },
    });
    return users;
  });
