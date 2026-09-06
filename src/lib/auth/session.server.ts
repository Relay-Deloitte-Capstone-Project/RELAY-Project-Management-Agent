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
