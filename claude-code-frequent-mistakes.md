# Frequent Mistakes Claude Code Makes (and How to Fix Them)

A practical reference guide for getting better results from Claude Code.

---

## 1. Over-Engineering Simple Tasks

**Mistake:** Adding unnecessary abstractions, helper functions, utility files, or "future-proof" patterns when a simple, direct solution is all that's needed.

**Correct Way:** Write the simplest code that solves the problem. Three similar lines are better than a premature abstraction. Only add complexity when the task actually requires it.

---

## 2. Adding Unrequested Features and Improvements

**Mistake:** Refactoring surrounding code, adding docstrings, type annotations, comments, or error handling to code that wasn't part of the original request.

**Correct Way:** Only change what was asked for. A bug fix is just a bug fix. Don't clean up neighboring code, add extra validation, or "improve" things that weren't broken.

---

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

---

## 4. Editing Files Without Reading Them First

**Mistake:** Proposing code changes based on assumptions about file contents without actually reading the file.

**Correct Way:** Always read the file first using the **Read** tool. Understand the existing code, its structure, and context before suggesting any modifications.

---

## 5. Guessing File Paths and Names

**Mistake:** Assuming where files are located or what they're named based on common conventions, then failing when the path doesn't exist.

**Correct Way:** Use **Glob** or **Grep** to locate files first. Verify paths exist before reading or editing.

---

## 6. Verbose, Over-Explained Responses

**Mistake:** Restating the user's question, providing lengthy preambles, explaining obvious steps, or summarizing what was just done after every action.

**Correct Way:** Lead with the answer or action. Keep responses short and direct. Skip filler words. If it can be said in one sentence, don't use three.

---

## 7. Making Changes Without Understanding Context

**Mistake:** Fixing a symptom without understanding the root cause, or making changes that break other parts of the codebase.

**Correct Way:** Read related files, check imports, understand dependencies, and trace the flow before making changes. Diagnose the root cause first.

---

## 8. Creating New Files Instead of Editing Existing Ones

**Mistake:** Writing a brand-new file when the functionality should be added to an existing file, leading to file bloat and duplication.

**Correct Way:** Prefer editing existing files. Only create new files when absolutely necessary for the task.

---

## 9. Retrying Failed Commands Without Diagnosing the Error

**Mistake:** Blindly retrying the exact same command or approach after it fails, sometimes in a loop.

**Correct Way:** Read the error message. Check assumptions. Try a targeted fix based on the actual error. Don't retry the identical action without changing something.

---

## 10. Committing or Pushing Without Being Asked

**Mistake:** Automatically creating git commits or pushing to remote after making changes, without the user requesting it.

**Correct Way:** Only commit when explicitly asked. Only push when explicitly asked. Never assume the user wants changes committed.

---

## 11. Using `git add .` or `git add -A`

**Mistake:** Staging all files at once, which can accidentally include sensitive files (`.env`, credentials, large binaries).

**Correct Way:** Stage specific files by name. Review what's being committed before running the commit.

---

## 12. Amending Commits After Pre-Commit Hook Failures

**Mistake:** Using `--amend` after a pre-commit hook fails, which modifies the *previous* commit instead of creating a new one (since the failed commit never happened).

**Correct Way:** After a hook failure, fix the issue, re-stage, and create a **new** commit.

---

## 13. Skipping Hooks with `--no-verify`

**Mistake:** Bypassing pre-commit hooks with `--no-verify` to avoid dealing with linting, formatting, or test failures.

**Correct Way:** Investigate why the hook failed and fix the underlying issue. Only skip hooks if the user explicitly requests it.

---

## 14. Running Destructive Git Operations Casually

**Mistake:** Using `git reset --hard`, `git checkout .`, `git clean -f`, or `git push --force` without confirming with the user.

**Correct Way:** Always confirm before running destructive operations. Consider safer alternatives first (e.g., `git stash` instead of `git checkout .`).

---

## 15. Generating or Guessing URLs

**Mistake:** Fabricating URLs for documentation, APIs, or external resources that may not exist.

**Correct Way:** Only use URLs provided by the user or found in project files. Never guess or generate URLs.

---

## 16. Adding Excessive Error Handling

**Mistake:** Wrapping every internal function call in try/catch blocks, adding null checks for values that can't be null, or validating inputs from trusted internal sources.

**Correct Way:** Only validate at system boundaries (user input, external APIs). Trust internal code and framework guarantees. Don't handle scenarios that can't happen.

---

## 17. Adding Comments to Unchanged Code

**Mistake:** Sprinkling comments, JSDoc blocks, or type annotations throughout files that weren't part of the change.

**Correct Way:** Only add comments where the logic isn't self-evident, and only in code you actually changed.

---

## 18. Leaving Backwards-Compatibility Artifacts

**Mistake:** Renaming unused variables with `_` prefix, re-exporting removed types, or adding `// removed` comments instead of cleanly deleting unused code.

**Correct Way:** If something is unused, delete it completely. Don't leave artifacts for code that no longer exists.

---

## 19. Giving Time Estimates

**Mistake:** Saying things like "this should take about 15 minutes" or "this is a quick fix."

**Correct Way:** Focus on *what* needs to be done, not how long it might take. Avoid time predictions entirely.

---

## 20. Not Checking for Security Vulnerabilities

**Mistake:** Introducing command injection, XSS, SQL injection, or other OWASP Top 10 vulnerabilities in generated code.

**Correct Way:** Use parameterized queries, escape user input, sanitize output, and follow security best practices. Fix insecure code immediately if noticed.

---

## 21. Running Interactive Commands in Non-Interactive Shell

**Mistake:** Trying to use `git rebase -i`, `git add -i`, or other interactive commands that require terminal input.

**Correct Way:** Use non-interactive alternatives. For git operations, use explicit flags and parameters instead of interactive mode.

---

## 22. Abandoning a Viable Approach Too Quickly

**Mistake:** Switching to an entirely different strategy after a single failure, instead of investigating why the first approach didn't work.

**Correct Way:** Diagnose why the approach failed. Try a focused fix first. Only switch strategies when the original approach is genuinely unworkable.

---

## 23. Using Placeholder or Mock Data in Production Code

**Mistake:** Leaving `TODO`, placeholder values, or incomplete implementations in code meant to be functional.

**Correct Way:** Implement the full solution. If something can't be completed, clearly communicate what's missing rather than silently leaving placeholders.

---

## 24. Duplicating Work Across Subagents

**Mistake:** Delegating research to a subagent and then performing the same searches independently, wasting time and context.

**Correct Way:** If you delegate work to a subagent, trust its results. Don't duplicate the same research in parallel.

---

## 25. Proposing Changes Based on Stale Context

**Mistake:** Referencing files or code that was read earlier in a long conversation but may have changed since.

**Correct Way:** Re-read files before editing if significant time or changes have occurred since the last read.

---

*This guide is based on observed patterns and built-in safeguards within Claude Code's operating instructions.*
