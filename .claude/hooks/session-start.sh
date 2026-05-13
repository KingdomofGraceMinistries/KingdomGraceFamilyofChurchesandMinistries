#!/usr/bin/env bash
# SessionStart hook — re-emit the KGFCM security frame and feedback memory
# at the top of every new session so the next model can't skim-read past it.
set -u

MEM_DIR="/home/codespace/.claude/projects/-workspaces-KingdomGraceFamilyofChurchesandMinistries/memory"
NO_DEMO=""
AUDIT=""
STAKES=""

if [ -f "$MEM_DIR/feedback_no_demo_grade_code.md" ]; then
  NO_DEMO=$(cat "$MEM_DIR/feedback_no_demo_grade_code.md")
fi
if [ -f "$MEM_DIR/feedback_audit_logger_only.md" ]; then
  AUDIT=$(cat "$MEM_DIR/feedback_audit_logger_only.md")
fi
if [ -f "$MEM_DIR/project_kgfcm_stakes.md" ]; then
  STAKES=$(cat "$MEM_DIR/project_kgfcm_stakes.md")
fi

CONTEXT=$(cat <<EOF
🛡️ KGFCM SECURITY FRAME — read this before any work on this codebase.

═══════════════════════════════════════════════════════════════
This is a PRODUCTION pastoral network handling confessional data
(burnout pulses, prayer requests, DM struggles, fasting breakthroughs).
Not an MVP. Not a prototype. Not a demo.
The user has explicitly rejected "we can do it later" framing.
═══════════════════════════════════════════════════════════════

${NO_DEMO}

───────────────────────────────────────────────────────────────

${AUDIT}

───────────────────────────────────────────────────────────────

${STAKES}

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
═══════════════════════════════════════════════════════════════
EOF
)

jq -n --arg ctx "$CONTEXT" '{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": $ctx
  }
}'
