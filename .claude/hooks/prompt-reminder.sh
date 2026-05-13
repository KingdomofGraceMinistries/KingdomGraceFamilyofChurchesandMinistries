#!/usr/bin/env bash
# UserPromptSubmit hook — when the user's prompt touches auth/security territory,
# inject a topic-trigger reminder that points at the durable feedback memory
# and reinforces STOP AND ASK before shipping anything stand-in-shaped.
set -u

INPUT=$(cat)
PROMPT=$(jq -r '.prompt // ""' <<<"$INPUT")

if grep -qiE '\b(auth|pin|hash|token|rls|security|reset|cors|policy|audit|password|encrypt|jwt|csp|xss|sql[[:space:]]*injection|webauthn|otp|vapid)\b' <<<"$PROMPT"; then
  jq -n '{
    "hookSpecificOutput": {
      "hookEventName": "UserPromptSubmit",
      "additionalContext": "⚠️ KGFCM SECURITY-TOPIC TRIGGER\nThis prompt touches auth / security / RLS / audit territory.\n\nBefore writing any code:\n  1. Consult memory/feedback_no_demo_grade_code.md (forbidden shortcuts list).\n  2. Consult memory/feedback_audit_logger_only.md (no console.* — audit() only).\n  3. If the real implementation requires server-side work (Argon2/bcrypt KDF, JWT verification on edge functions, email/SMS side channel for reset codes), STOP AND ASK — do NOT ship a stand-in like btoa() or Math.random().\n\nPer CLAUDE.md this is a production pastoral network handling confessional data. No MVP shortcuts. PreToolUse hooks will hard-block: btoa-as-hash, console.*, Math.random in auth code, MVP-frame comments, CORS wildcards, and open anon RLS."
    }
  }'
fi

exit 0
