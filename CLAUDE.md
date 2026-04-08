# Claude Instructions for Kingdom Grace Family of Churches and Ministries

---

## Project Overview

**Kingdom Grace Pastoral Network** — a mobile-first progressive web app (PWA) for pastoral care, check-ins, prayer walls, devotionals, and bishop oversight.

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Frontend | Single HTML file (`kg-pastoral-network.html`) — vanilla HTML/CSS/JS |
| Backend | Supabase (PostgreSQL + REST API + Edge Functions) |
| AI | Claude API via Supabase edge function proxy (`kgfcm-ai-proxy`) |
| Hosting | Vercel (static site deployment) |
| PWA | `manifest.json` + mobile-web-app meta tags |

**This is NOT a React/Vite/Node.js project.** It is a self-contained static HTML application. There is no build step, no bundler, no framework.

### Key Files
| File | Purpose |
|------|---------|
| `kg-pastoral-network.html` | The entire application (UI + logic) |
| `manifest.json` | PWA manifest for install-to-homescreen |
| `vercel.json` | Vercel deployment routing and security headers |
| `package.json` | Metadata and `npx serve` for local dev |
| `CLAUDE.md` | This file — project rules for Claude Code |
| `governance-boundaries.md` | Architecture boundary documentation |

### Users & Roles
| Role | Access |
|------|--------|
| **Bishop** (Peter Sasser) | Full dashboard — oversight of all pastors, messaging, analytics |
| **Pastors** | Check-ins, prayer wall, devotionals, peer messaging |

---

## Quick Reference - Core Rules

| # | Rule | Violation = Reject |
|---|------|-------------------|
| 1 | **STOP AND ASK** if unclear, blocked, or choosing between approaches | Guessing, improvising |
| 2 | **No workarounds** - if blocked, ask | "temporary fix", "for now", "hack" |
| 3 | **No sensitive data in code** - credentials stay in Supabase env | API keys, PINs hardcoded in commits |
| 4 | **Test changes visually** - verify the app still works after edits | Blind edits to a 1800-line file |
| 5 | **No CORS/CSP wildcards** - use explicit origins only | `frame-ancestors *`, `connect-src *` |
| 6 | **Preserve existing functionality** - be a surgeon, not a butcher | Breaking features while adding new ones |
| 7 | **Read before editing** - this is a large single-file app, understand context first | Guessing what's in the file |

### Before Every Task
```bash
git log --oneline -3     # Review recent commits
# Open kg-pastoral-network.html in browser to verify current state
```

---

## CRITICAL RULES - READ FIRST

### Development Philosophy - NON-NEGOTIABLE

**"I have time to do it right. I do not have time to do it twice."**

**"Always be a pace car, never a race car."**

**"Be a surgeon, never a butcher."**

These are not suggestions. They are requirements.

---

### Default Assumption - PRODUCTION FIRST

**ALL code in this codebase is production-ready.**

There is no "quick version" followed by "real version."
The first version IS the real version.

- No hardcoded values that should be fetched from database
- No placeholder implementations
- No "we can improve this later"
- No shortcuts that require a second commit to fix

---

### NO WORKAROUNDS POLICY - ABSOLUTE

- **Do NOT implement workarounds, hacks, or "temporary" solutions**
- If blocked, **STOP and ASK** - do not improvise
- If you find yourself typing "workaround", "hack", "temporary fix", "for now", or "we can refactor later" - **STOP IMMEDIATELY**
- Workarounds ARE technical debt. Technical debt is forbidden.

---

### STOP AND ASK PROTOCOL

**When ANY of these apply, STOP and ask before proceeding:**

- Requirements are unclear or ambiguous
- Multiple valid implementation approaches exist
- You're about to change an existing pattern
- You're about to delete anything (functions, sections, features)
- The "right" solution seems harder than a shortcut
- You're unsure if something violates these rules
- **You've tried to fix the same error 2+ times** - you likely have a blind spot

**Do NOT guess. Do NOT improvise. ASK.**

---

### Zero Technical Debt - ENFORCED

- Do NOT introduce technical debt with quick fixes
- Always implement proper, maintainable solutions
- "We can fix it later" is not acceptable

---

## Common AI Mistakes - Why These Rules Exist

| AI Mistake | Our Prevention | Why AIs Do This |
|------------|----------------|-----------------|
| `console.log` debugging left in code | Clean up all debug output | Quick output during generation |
| Creating new files instead of editing | "Prefer editing existing files" | Starting fresh feels easier than understanding |
| Guessing when blocked | STOP AND ASK protocol | AIs want to appear helpful, not "stuck" |
| "Temporary" workarounds | No workarounds policy | Solves immediate problem, defers pain |
| Deleting "unused" code aggressively | Everything in the HTML is a feature | Cleanup instinct without context |
| Over-engineering simple requests | "Surgeon, not butcher" | AIs love showing off abstractions |
| Silent error swallowing | Must handle errors visibly | Empty catch blocks "handle" errors |
| Iterating on broken code instead of stopping | STOP AND ASK when stuck | Wants to appear helpful, not stuck |
| Breaking the single-file structure | Keep everything in one HTML file | Instinct to "organize" into multiple files |
| Adding frameworks/libraries unnecessarily | Vanilla JS is intentional | Training data is framework-heavy |

**The STOP AND ASK protocol is the highest-value rule.** Most AI mistakes stem from continuing when uncertain rather than asking.

---

## Architecture Rules

### Single-File Application

This entire app lives in `kg-pastoral-network.html`. This is **intentional**. Do NOT:
- Split it into multiple files without explicit approval
- Add a build system (Webpack, Vite, Rollup, etc.)
- Convert it to React, Vue, or any framework
- Add npm dependencies that require bundling

The single-file architecture means:
- **Zero build step** — deploy by pushing HTML
- **Instant loading** — no waterfall of JS/CSS requests
- **Simple hosting** — works on any static host

### Supabase Integration

The app uses Supabase REST API directly (no JS SDK). All database calls go through these helper functions defined in the HTML:

| Function | Purpose |
|----------|---------|
| `SB_INSERT(table, data)` | POST to Supabase REST API |
| `SB_UPDATE(table, filter, data)` | PATCH to Supabase REST API |
| `SB_DELETE(table, filter)` | DELETE from Supabase REST API |
| `SB_GET(table, params)` | GET from Supabase REST API |
| `AI_CALL(prompt)` | Call Claude via edge function proxy |

**Config block** (top of `<script>` tag):
```javascript
const C = {
  networkName:   "Kingdom Grace Family of Churches and Ministries",
  networkShort:  "Kingdom Grace",
  appId:         "kgfcm",
  bishopName:    "Bishop Peter Sasser",
  bishopTitle:   "Presiding Bishop · Kingdom Grace",
  bishopPin:     "000000",
  supabaseUrl:   "https://YOUR_PROJECT.supabase.co",
  supabaseKey:   "YOUR_ANON_KEY",
  aiProxyFn:     "kgfcm-ai-proxy",
};
```

**IMPORTANT:** Before deploying, replace `YOUR_PROJECT` and `YOUR_ANON_KEY` with real Supabase credentials. Never commit real credentials.

### Database Tables (defined in HTML comments)

| Table | Purpose |
|-------|---------|
| `rf_pastors` | Pastor profiles and auth |
| `rf_checkins` | Daily/weekly pastor check-ins |
| `rf_devotional_responses` | Responses to weekly devotional prompts |
| `rf_prayer_requests` | Prayer wall entries |
| `rf_wins` | Celebration/testimony posts |
| `rf_direct_messages` | Pastor-to-pastor and bishop messaging |
| `rf_bishop_messages` | Bishop broadcast messages |
| `rf_announcements` | Pastor announcements with optional images |

### Security

- **PIN-based authentication** for bishops and pastors
- **RLS enabled** on `rf_checkins`, `rf_direct_messages`, `rf_pastors`
- **No PII in client-side logs** — keep names, contact info server-side where possible
- **No CORS wildcards** — explicit origins only in edge functions
- **No CSP wildcards** — Vercel headers enforce strict policies

---

## Code Quality Standards

### Working with the HTML File

The app is ~1,800 lines. When editing:

1. **Always read the relevant section first** — use Grep to find the function/section before editing
2. **Understand the screen system** — the app uses `.screen.active` class toggling for navigation
3. **Respect the CSS variable system** — colors are defined in `:root`, use `var(--gold)`, `var(--ink)`, etc.
4. **Test that navigation still works** — screens are shown/hidden via JS, not routes
5. **Keep the code style consistent** — match the existing minified-but-readable style

### CSS Variables (Design System)

| Variable | Value | Use |
|----------|-------|-----|
| `--ink` | `#0a0a0f` | Primary background |
| `--gold` | `#c8a84c` | Accent, brand color |
| `--frost` | `#f8f6f0` | Primary text |
| `--mist` | `#a8a090` | Secondary text |
| `--flame` | `#e85d3a` | Danger/alert |
| `--sage` | `#4a8c6a` | Success |
| `--sky` | `#3a6ea8` | Info |

### Fonts
- **Cormorant Garamond** — headings, titles (serif, elegant)
- **DM Sans** — body text, UI elements (clean sans-serif)

---

## Deployment

### Vercel
- Push to `main` branch triggers automatic deployment
- `vercel.json` routes all paths to the HTML file
- Security headers are configured in `vercel.json`

### PWA
- `manifest.json` enables "Add to Home Screen" on mobile
- Icons needed in `/icons/` directory (192x192 and 512x512 PNG)
- Theme color matches the dark UI (`#0a0a0f`)

---

## Git Workflow

- Main branch: `main`
- Only commit when explicitly requested
- Follow existing commit message patterns
- Always review last 3 commits before starting work

---

## Governance Boundaries

See `governance-boundaries.md` for the full architectural boundary map covering:
- System A (WellFit) vs System B (Envision Atlus) separation
- Shared Spine services
- Cross-system read paths
- Data ownership rules
- Refactor guardrails

---
---

# Part 2: Frequent Mistakes Claude Code Makes (and How to Fix Them)

A practical reference guide. Claude Code must follow these corrective patterns.

---

## 1. Over-Engineering Simple Tasks

**Mistake:** Adding unnecessary abstractions, helper functions, utility files, or "future-proof" patterns when a simple, direct solution is all that's needed.

**Correct Way:** Write the simplest code that solves the problem. Three similar lines are better than a premature abstraction. Only add complexity when the task actually requires it.

## 2. Adding Unrequested Features and Improvements

**Mistake:** Refactoring surrounding code, adding docstrings, type annotations, comments, or error handling to code that wasn't part of the original request.

**Correct Way:** Only change what was asked for. A bug fix is just a bug fix. Don't clean up neighboring code, add extra validation, or "improve" things that weren't broken.

## 3. Using Bash Commands Instead of Dedicated Tools

**Mistake:** Running `cat`, `grep`, `find`, `sed`, `awk`, or `echo` via the Bash tool to read, search, or edit files.

**Correct Way:**
| Instead of... | Use... |
|---|---|
| `cat file.txt` | **Read** tool |
| `grep -r "pattern"` | **Grep** tool |
| `find . -name "*.js"` | **Glob** tool |
| `sed -i 's/old/new/'` | **Edit** tool |
| `echo "content" > file` | **Write** tool |

## 4. Editing Files Without Reading Them First

**Mistake:** Proposing code changes based on assumptions about file contents without actually reading the file.

**Correct Way:** Always read the file first using the **Read** tool. Understand the existing code, its structure, and context before suggesting any modifications.

## 5. Guessing File Paths and Names

**Mistake:** Assuming where files are located or what they're named based on common conventions, then failing when the path doesn't exist.

**Correct Way:** Use **Glob** or **Grep** to locate files first. Verify paths exist before reading or editing.

## 6. Verbose, Over-Explained Responses

**Mistake:** Restating the user's question, providing lengthy preambles, explaining obvious steps, or summarizing what was just done after every action.

**Correct Way:** Lead with the answer or action. Keep responses short and direct. Skip filler words. If it can be said in one sentence, don't use three.

## 7. Making Changes Without Understanding Context

**Mistake:** Fixing a symptom without understanding the root cause, or making changes that break other parts of the codebase.

**Correct Way:** Read related files, check imports, understand dependencies, and trace the flow before making changes. Diagnose the root cause first.

## 8. Creating New Files Instead of Editing Existing Ones

**Mistake:** Writing a brand-new file when the functionality should be added to an existing file, leading to file bloat and duplication.

**Correct Way:** Prefer editing existing files. Only create new files when absolutely necessary for the task.

## 9. Retrying Failed Commands Without Diagnosing the Error

**Mistake:** Blindly retrying the exact same command or approach after it fails, sometimes in a loop.

**Correct Way:** Read the error message. Check assumptions. Try a targeted fix based on the actual error. Don't retry the identical action without changing something.

## 10. Committing or Pushing Without Being Asked

**Mistake:** Automatically creating git commits or pushing to remote after making changes, without the user requesting it.

**Correct Way:** Only commit when explicitly asked. Only push when explicitly asked. Never assume the user wants changes committed.

## 11. Using `git add .` or `git add -A`

**Mistake:** Staging all files at once, which can accidentally include sensitive files (`.env`, credentials, large binaries).

**Correct Way:** Stage specific files by name. Review what's being committed before running the commit.

## 12. Amending Commits After Pre-Commit Hook Failures

**Mistake:** Using `--amend` after a pre-commit hook fails, which modifies the *previous* commit instead of creating a new one (since the failed commit never happened).

**Correct Way:** After a hook failure, fix the issue, re-stage, and create a **new** commit.

## 13. Skipping Hooks with `--no-verify`

**Mistake:** Bypassing pre-commit hooks with `--no-verify` to avoid dealing with linting, formatting, or test failures.

**Correct Way:** Investigate why the hook failed and fix the underlying issue. Only skip hooks if the user explicitly requests it.

## 14. Running Destructive Git Operations Casually

**Mistake:** Using `git reset --hard`, `git checkout .`, `git clean -f`, or `git push --force` without confirming with the user.

**Correct Way:** Always confirm before running destructive operations. Consider safer alternatives first (e.g., `git stash` instead of `git checkout .`).

## 15. Generating or Guessing URLs

**Mistake:** Fabricating URLs for documentation, APIs, or external resources that may not exist.

**Correct Way:** Only use URLs provided by the user or found in project files. Never guess or generate URLs.

## 16. Adding Excessive Error Handling

**Mistake:** Wrapping every internal function call in try/catch blocks, adding null checks for values that can't be null, or validating inputs from trusted internal sources.

**Correct Way:** Only validate at system boundaries (user input, external APIs). Trust internal code and framework guarantees. Don't handle scenarios that can't happen.

## 17. Adding Comments to Unchanged Code

**Mistake:** Sprinkling comments, JSDoc blocks, or type annotations throughout files that weren't part of the change.

**Correct Way:** Only add comments where the logic isn't self-evident, and only in code you actually changed.

## 18. Leaving Backwards-Compatibility Artifacts

**Mistake:** Renaming unused variables with `_` prefix, re-exporting removed types, or adding `// removed` comments instead of cleanly deleting unused code.

**Correct Way:** If something is unused, delete it completely. Don't leave artifacts for code that no longer exists.

## 19. Giving Time Estimates

**Mistake:** Saying things like "this should take about 15 minutes" or "this is a quick fix."

**Correct Way:** Focus on *what* needs to be done, not how long it might take. Avoid time predictions entirely.

## 20. Not Checking for Security Vulnerabilities

**Mistake:** Introducing command injection, XSS, SQL injection, or other OWASP Top 10 vulnerabilities in generated code.

**Correct Way:** Use parameterized queries, escape user input, sanitize output, and follow security best practices. Fix insecure code immediately if noticed.

## 21. Running Interactive Commands in Non-Interactive Shell

**Mistake:** Trying to use `git rebase -i`, `git add -i`, or other interactive commands that require terminal input.

**Correct Way:** Use non-interactive alternatives. For git operations, use explicit flags and parameters instead of interactive mode.

## 22. Abandoning a Viable Approach Too Quickly

**Mistake:** Switching to an entirely different strategy after a single failure, instead of investigating why the first approach didn't work.

**Correct Way:** Diagnose why the approach failed. Try a focused fix first. Only switch strategies when the original approach is genuinely unworkable.

## 23. Using Placeholder or Mock Data in Production Code

**Mistake:** Leaving `TODO`, placeholder values, or incomplete implementations in code meant to be functional.

**Correct Way:** Implement the full solution. If something can't be completed, clearly communicate what's missing rather than silently leaving placeholders.

## 24. Duplicating Work Across Subagents

**Mistake:** Delegating research to a subagent and then performing the same searches independently, wasting time and context.

**Correct Way:** If you delegate work to a subagent, trust its results. Don't duplicate the same research in parallel.

## 25. Proposing Changes Based on Stale Context

**Mistake:** Referencing files or code that was read earlier in a long conversation but may have changed since.

**Correct Way:** Re-read files before editing if significant time or changes have occurred since the last read.
