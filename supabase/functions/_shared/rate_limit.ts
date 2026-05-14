// Per-email and per-IP rate limiter backed by rf_reset_attempts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.50.5";
import { hashIdentifier } from "./audit.ts";

const PER_EMAIL_LIMIT = 5;
const PER_IP_LIMIT    = 20;
const WINDOW_MINUTES  = 60;

type Kind = "login" | "reset" | "register";

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

  const [emailRes, ipRes] = await Promise.all([
    countAttempts(input.supa, "email_hash", emailHash, windowStart),
    countAttempts(input.supa, "ip_hash",    ipHash,    windowStart),
  ]);

  const limited =
    emailRes.count > PER_EMAIL_LIMIT ||
    ipRes.count    > PER_IP_LIMIT;

  await input.supa.from("rf_reset_attempts").insert({
    email_hash: emailHash,
    ip_hash:    ipHash,
    kind:       input.kind,
  });

  return { limited, emailHash, ipHash };
}

async function countAttempts(
  supa: SupabaseClient,
  col: "email_hash" | "ip_hash",
  val: string,
  windowStart: string,
): Promise<{ count: number }> {
  const res = await supa
    .from("rf_reset_attempts")
    .select("id")
    .eq(col, val)
    .gte("created_at", windowStart);
  const rows = Array.isArray(res.data) ? res.data.length : 0;
  return { count: rows };
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
