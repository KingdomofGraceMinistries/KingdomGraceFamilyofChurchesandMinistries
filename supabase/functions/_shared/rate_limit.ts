// Per-email and per-IP rate limiter backed by rf_reset_attempts.
//
// Each kind is counted only against attempts of the same kind, so AI use
// never locks a pastor out of login and one person's resets never spend
// another's login budget. Limits are "at most N per window".
//
// The per-IP limits are sized for the whole network (~30 pastors) signing
// in from one venue or church Wi-Fi at once — a shared NAT address — with
// room for mistyped PINs. The per-email limits are what stop PIN guessing
// against a single account; per-IP only bounds spraying across accounts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.119.0";
import { hashIdentifier } from "./audit.ts";

const WINDOW_MINUTES = 60;

export type Kind = "login" | "reset" | "register" | "ai";

export const LIMITS: Record<Kind, { perEmail: number; perIp: number }> = {
  login:    { perEmail: 5,  perIp: 100 },
  reset:    { perEmail: 5,  perIp: 40  },
  register: { perEmail: 5,  perIp: 100 },
  ai:       { perEmail: 30, perIp: 300 },
};

export interface RateLimitInput {
  supa:  SupabaseClient;
  email: string;
  ip:    string;
  kind:  Kind;
}

export interface RateLimitResult {
  limited:   boolean;
  emailHash: string;
  ipHash:    string;
}

export async function rateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  const emailHash = await hashIdentifier(input.email);
  const ipHash    = await hashIdentifier(input.ip);
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const [emailCount, ipCount] = await Promise.all([
    countAttempts(input.supa, input.kind, "email_hash", emailHash, windowStart),
    countAttempts(input.supa, input.kind, "ip_hash",    ipHash,    windowStart),
  ]);

  const limit = LIMITS[input.kind];
  const limited = emailCount >= limit.perEmail || ipCount >= limit.perIp;

  // A write that silently failed would leave the attempt uncounted and the
  // limit permanently open, so a database error fails closed: it throws into
  // the caller's audited 500 path rather than letting the request through.
  const ins = await input.supa.from("rf_reset_attempts").insert({
    email_hash: emailHash,
    ip_hash:    ipHash,
    kind:       input.kind,
  });
  if (ins.error) throw new Error(`rate limit record failed: ${ins.error.message}`);

  return { limited, emailHash, ipHash };
}

async function countAttempts(
  supa: SupabaseClient,
  kind: Kind,
  col: "email_hash" | "ip_hash",
  val: string,
  windowStart: string,
): Promise<number> {
  const res = await supa
    .from("rf_reset_attempts")
    .select("id", { count: "exact", head: true })
    .eq("kind", kind)
    .eq(col, val)
    .gte("created_at", windowStart);
  if (res.error || res.count === null) {
    throw new Error(`rate limit count failed: ${res.error?.message ?? "no count returned"}`);
  }
  return res.count;
}

export function padTo(started: number, targetMs = 400): Promise<void> {
  const elapsed = performance.now() - started;
  const remaining = Math.max(0, targetMs - elapsed);
  return new Promise((resolve) => setTimeout(resolve, remaining));
}

// CSPRNG hex token. 4 bytes → 8 hex chars (4B combinations).
export function generateCode(bytes = 4): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashCode(code: string): Promise<string> {
  return await hashIdentifier(code);
}
