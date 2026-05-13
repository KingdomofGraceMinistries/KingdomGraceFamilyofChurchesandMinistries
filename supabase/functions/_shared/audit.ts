// Server-side audit writer. Bypasses client forgery — only edge functions
// running under service_role call this. Every error path in every function
// MUST go through audit() — never through console.* (SEC-6).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export async function audit(
  supa: SupabaseClient,
  eventType: string,
  meta: {
    actor_id?: string;
    actor_role?: string;
    target_table?: string;
    target_id?: string;
    ip_address?: string;
    [k: string]: unknown;
  } = {},
): Promise<void> {
  const { actor_id, actor_role, target_table, target_id, ip_address, ...rest } = meta;
  const { error } = await supa.from("rf_audit_log").insert({
    event_type: eventType,
    actor_id: actor_id ?? "system",
    actor_role: actor_role ?? "service",
    target_table: target_table ?? null,
    target_id: target_id ?? null,
    metadata: rest,
    ip_address: ip_address ?? null,
  });
  // If audit fails, attempt a single retry with a synthetic ERROR row;
  // if THAT fails, drop the trace (better than crashing the request).
  if (error) {
    try {
      await supa.from("rf_audit_log").insert({
        event_type: "AUDIT_WRITE_FAILED",
        actor_id: "system",
        actor_role: "service",
        metadata: { original_event: eventType, error: String(error) },
      });
    } catch (_) {
      // intentional drop
    }
  }
}

// SHA-256 hex of a lowercased identifier — used to keep emails/IPs out of
// rf_reset_attempts in plaintext.
export async function hashIdentifier(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
