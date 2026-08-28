#!/usr/bin/env bash
# SessionStart hook — re-emit the KGFCM security frame, the connector-target
# guard, and the feedback memory at the top of every new session so the next
# model can't skim-read past them.
set -u

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

# Guard docs live in the repo at memory/ (the hook messages in
# content-scan.sh cite those paths, so a human who trips the guard can read
# them). Fall back to the per-machine Claude memory dir for anything not yet
# promoted into the repo.
AUTO_MEM="/home/codespace/.claude/projects/-workspaces-KingdomGraceFamilyofChurchesandMinistries/memory"

read_memory() {
  # $1 = filename; prefer the in-repo copy, fall back to auto-memory.
  if   [ -f "$ROOT/memory/$1" ];  then cat "$ROOT/memory/$1"
  elif [ -f "$AUTO_MEM/$1" ];     then cat "$AUTO_MEM/$1"
  fi
}

NO_DEMO=$(read_memory feedback_no_demo_grade_code.md)
AUDIT=$(read_memory feedback_audit_logger_only.md)

CONTEXT=$(cat <<EOF
🛡️ KGFCM SECURITY FRAME — read this before any work on this codebase.

═══════════════════════════════════════════════════════════════
This is a PRODUCTION pastoral network handling confessional data
(burnout pulses, prayer requests, DM struggles, fasting breakthroughs).
Not an MVP. Not a prototype. Not a demo.
The user has explicitly rejected "we can do it later" framing.
═══════════════════════════════════════════════════════════════

═══════════════════════════════════════════════════════════════
CONNECTOR TARGET — verify before any write.

  Supabase project   kseocbwhuveieqhayske
  Vercel team        kingdomofgraceministries-projects
  Production domain  kingdomgracefamily.com

Claude's connectors authenticate to an ACCOUNT, not to this repo.
They persist across sessions and across projects, so they can still
be pointed at other work. GitHub -> Vercel -> Supabase being wired
correctly does NOT mean the Claude connector is. That is a second,
separate connection per service and nothing warns you when it is
pointed elsewhere.

Before any schema, data, secret or deploy write, confirm the target:

    npx supabase@latest projects list      # expect kseocbwhuveieqhayske

An unexpected project in a connector listing is a MISCONFIGURATION,
never a discovery. Stop and re-check the connection — do not reason
about why the unexpected project might be relevant.

Real incident, 2026-08-28: a session opened with the connector still
authenticated to another of the operator's accounts. The unrelated
project it listed was mistaken for one side of the "System A / System
B" boundary named in CLAUDE.md and written into governance-boundaries.md
before the operator caught it. No data was touched, but a different
client's project ref reached this repo. See governance-boundaries.md
section 2.1.

NOTE: the System A / System B language in CLAUDE.md is carry-over from
the operator's other work. It does NOT describe this codebase.
Kingdom Grace is a standalone system.
═══════════════════════════════════════════════════════════════

${NO_DEMO}

───────────────────────────────────────────────────────────────

${AUDIT}

═══════════════════════════════════════════════════════════════
HARD-BLOCK HOOKS ARE LIVE IN THIS PROJECT.

PreToolUse Edit/Write will refuse:
  • btoa() assigned to or called on a security-sensitive name/value
  • console.log / error / warn / debug / info
  • Math.random() in auth-adjacent files or near security keywords
  • "for this MVP", "for now,", "we can refactor later",
    "in production this would", "we can improve later", "TODO: hash"
  • Access-Control-Allow-Origin: "*"
  • SQL RLS policies that grant anon with using(true) / with check(true)
  • Embedded supabase functions deploy --no-verify-jwt

PreToolUse Bash will refuse:
  • supabase functions deploy --no-verify-jwt
  • git --no-verify on commit/push/merge/rebase
  • git push --force
  • git add . / -A / --all
  • git reset --hard, git clean -f, git checkout ., git restore .
  • --no-gpg-sign / commit.gpgsign=false

.githooks/pre-commit runs the same content scanner over staged files.

DO NOT TRY TO BYPASS THESE HOOKS. Fix the underlying code instead.

Migrations are CLI-only — never apply DDL through the MCP connector.
See PROJECT_STATE.md section D.
═══════════════════════════════════════════════════════════════
EOF
)

jq -n --arg ctx "$CONTEXT" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
