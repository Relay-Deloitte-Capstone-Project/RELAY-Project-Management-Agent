import { createMiddleware } from "@tanstack/react-start";
import { prisma } from "@/lib/db";
import { readSessionToken, verifyToken } from "@/lib/auth/session.server";

/**
 * Attach to any createServerFn that needs a logged-in user. A route
 * `beforeLoad` redirect is page UX only — it does not stop this RPC from
 * being called directly, so the check has to live here too.
 *
 * The session check is inlined here (not a shared top-level helper)
 * because only the literal `.server()`/`.handler()` callback bodies get
 * compiler-extracted out of the client bundle — a plain exported function
 * that merely gets *called* from inside one still ships its own imports
 * (including `session.server`'s `@tanstack/react-start/server` import) to
 * the client, which this project's import-protection plugin rejects.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const token = readSessionToken();
  if (!token) throw new Error("Unauthorized");
  const payload = verifyToken(token);
  if (!payload) throw new Error("Unauthorized");

  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) throw new Error("Unauthorized");

  return next({ context: { user: payload } });
});
