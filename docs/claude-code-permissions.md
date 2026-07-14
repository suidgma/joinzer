# Reducing Claude Code permission prompts while building

## The problem
While building with Claude Code, you get frequent "Allow this command?" prompts — especially on `git`, `gh`, build commands, and DB calls. They interrupt flow. This is Claude Code's safety layer asking before running Bash commands or tools. You can dramatically reduce them with a mix of **config** and **command style**.

## Where permissions live (not CLAUDE.md)
- `.claude/settings.json` — project-level, committed/shared with the team
- `.claude/settings.local.json` — **personal, gitignored** (per-developer)
- `CLAUDE.md` — instructions *to* the agent; it can't grant permissions, but it can steer the agent toward commands that auto-approve.

## Two root causes of the prompts (both important)
1. **Compound `cd` prefixes.** If the agent runs `cd /path/to/repo && git commit …`, the leading `cd` in a chained command defeats the allow rules and forces a prompt. Claude Code's Bash working directory already persists at the repo root, so the `cd` is unnecessary — plain `git commit …` matches an allow rule and runs clean.
2. **Heredocs and loops can't be auto-approved.** Commands like `git commit -m "$(cat <<'EOF' … EOF)"` or `for i in 1..5; do gh pr merge …; done` can't be generalized into a reusable rule — that's why those prompts don't even offer an "always allow" button. The fix is to write them as simple commands: repeated `-m` flags for multi-line commit messages, and a single `gh pr merge` instead of a retry loop.

## The fix — two levers

### 1. An allowlist (safe, recommended)
Add trusted command families to `.claude/settings.local.json` so they never prompt:

```jsonc
{
  "permissions": {
    "defaultMode": "acceptEdits",   // auto-accept file edits (huge on its own)
    "allow": [
      "Bash(git:*)",
      "Bash(gh:*)",
      "Bash(npx:*)",
      "Bash(npm:*)",
      "Bash(node:*)"
      // add MCP tools you trust, e.g. Supabase:
      // "mcp__<server>__execute_sql",
      // "mcp__<server>__apply_migration"
    ],
    "deny": [
      "Bash(git push --force:*)",
      "Bash(git push -f:*)"
    ]
  }
}
```

- `allow` — command prefixes that run without asking. `Bash(git:*)` = any git subcommand.
- `defaultMode: "acceptEdits"` — auto-accepts all file edits (Claude edits constantly, so this alone removes a lot of stoppages). **Requires restarting Claude Code to take effect;** allow-rule changes apply live.
- `deny` — a hard backstop for things you never want (e.g., force-push). Keep it minimal so you don't block legit commands (e.g., don't broadly deny `rm -rf` if you use `rm -rf .next`).

### 2. Bypass mode (nuclear — zero prompts, no guardrails)
If you want *no* prompts and accept the risk (reasonable for a solo dev in a git-backed repo where everything's recoverable):
- Launch with `claude --dangerously-skip-permissions`, or
- Set `"permissions": { "defaultMode": "bypassPermissions" }`

Tradeoff: a bad command runs without asking. The allowlist above is the safer middle ground.

## Helpful extras
- **`/permissions`** — a slash command to view/add rules interactively. When a normal prompt offers "Yes, and don't ask again," clicking it writes the rule for you.
- **Steer the agent via CLAUDE.md.** Add a note so every session uses prompt-friendly commands, e.g.:
  > *Run commands without a `cd /repo &&` prefix (the working dir persists). Use repeated `-m` flags instead of heredoc commit messages, and a single `gh pr merge` (no retry loop), so commands match the `.claude` allowlist and auto-approve.*
- **Keep personal settings out of the repo.** `.claude/settings.local.json` should be gitignored (add `.claude/` to `.gitignore`). If it got committed before the ignore rule, untrack it without deleting it: `git rm --cached .claude/settings.local.json` then commit. The file keeps working locally; git just stops versioning it.

## TL;DR
- Add an **allowlist** for `git` / `gh` / `npx` / `npm` / `node` (+ trusted MCP tools) in `.claude/settings.local.json`, plus `defaultMode: "acceptEdits"`. Restart once.
- Have the agent **avoid `cd` prefixes, heredocs, and loops** (a CLAUDE.md note enforces this).
- Want zero prompts? `--dangerously-skip-permissions` / `bypassPermissions` — at the cost of the safety net.
