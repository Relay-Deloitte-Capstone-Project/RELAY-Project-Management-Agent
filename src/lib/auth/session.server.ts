import jwt from "jsonwebtoken";
import { getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import type { SessionUser } from "./types";

const COOKIE = "relay_session";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) throw new Error("JWT_SECRET is not set");
  return secret;
}

export function signToken(payload: SessionUser): string {
  return jwt.sign(payload, getSecret(), { expiresIn: TTL_SECONDS });
}

// Short-lived (15 min), separate from the 30-day session cookie above and
// signed with the same shared secret the Python backend now verifies
// (backend/api/auth.py). This is what lets client-side JS call the FastAPI
// API as a verified person: the session cookie itself is HttpOnly, so
// browser JS can never read it to attach as a request header — this token
// is minted specifically to be readable and short-lived instead. See
// getAskApiToken in functions.ts for how a client actually obtains one.
const API_TOKEN_TTL_SECONDS = 60 * 15;

export function signApiToken(payload: SessionUser): string {
  // `payload` here is almost always `context.user` from authMiddleware,
  // which is jwt.verify()'s decoded return value from the 30-day session
  // cookie — not a fresh object. That decoded value carries jsonwebtoken's
  // own registered claims (exp, iat, and nbf if set) alongside the
  // SessionUser fields, because verifying a token returns its whole payload,
  // claims included. Signing that straight through with `expiresIn` set
  // makes jsonwebtoken throw ("Bad \"options.expiresIn\" option the payload
  // already has an \"exp\" property") since a payload can't carry both an
  // explicit exp and an expiresIn option — which was failing on every
  // single call, everywhere in the app, since this is the one function every
  // backend request mints a token through. Rebuilding a clean object with
  // only the real SessionUser fields strips those leaked claims regardless
  // of what the caller passes in.
  const clean: SessionUser = {
    id: payload.id,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    initials: payload.initials,
    avatarColor: payload.avatarColor,
  };
  return jwt.sign(clean, getSecret(), { expiresIn: API_TOKEN_TTL_SECONDS });
}

export function verifyToken(token: string): SessionUser | null {
  try {
    return jwt.verify(token, getSecret()) as SessionUser;
  } catch {
    return null;
  }
}

export function readSessionToken(): string | null {
  const header = getRequestHeader("cookie");
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq) === COOKIE) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

export function setSessionCookie(token: string) {
  const secure = process.env["NODE_ENV"] === "production";
  setResponseHeader(
    "Set-Cookie",
    [
      `${COOKIE}=${encodeURIComponent(token)}`,
      "HttpOnly",
      secure ? "Secure" : "",
      "SameSite=Lax",
      "Path=/",
      `Max-Age=${TTL_SECONDS}`,
    ]
      .filter(Boolean)
      .join("; "),
  );
}

export function clearSessionCookie() {
  const secure = process.env["NODE_ENV"] === "production";
  setResponseHeader(
    "Set-Cookie",
    [`${COOKIE}=`, "HttpOnly", secure ? "Secure" : "", "SameSite=Lax", "Path=/", "Max-Age=0"]
      .filter(Boolean)
      .join("; "),
  );
}
