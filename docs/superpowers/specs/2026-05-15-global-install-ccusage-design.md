# ccusage-widget — Global Install Design

**Date:** 2026-05-15
**Status:** Approved for planning
**Scope:** Replace `npx ccusage@latest` invocation with a globally-installed `ccusage` binary, including install guidance and a convenience install command.

## Summary

The extension currently defaults to `npx ccusage@latest` which downloads and bootstraps ccusage on every poll, adding latency and network overhead. This change switches the default to calling a globally-installed `ccusage` binary directly, and adds a guided install flow when the binary is not found on PATH.

## Goals

- Call `ccusage` directly (no npx), making every poll faster and lighter.
- When `ccusage` is not on PATH, prompt the user with a one-time popup offering a one-click install.
- Provide a `ccusageWidget.installCcusage` command to install or update ccusage globally at any time.
- Keep the `ccusageWidget.ccusageCommand` setting so users can override the binary path if needed.

## Non-goals

- Automatic version-update checks (user runs the install command manually to update).
- Fallback to `npx` — there is no fallback. If the binary is missing, the user is prompted to install it.
- Per-OS package manager support (brew, winget, etc.) — `npm install -g` only for now.

## Changed behavior

### `ccusageWidget.ccusageCommand` setting

| | Before | After |
|---|---|---|
| Default | `"npx ccusage@latest"` | `"ccusage"` |
| Description | "Command used to invoke ccusage. Override to 'ccusage' if installed globally." | "Command used to invoke ccusage. Must be installed globally: `npm install -g ccusage`" |

### New command: `ccusageWidget.installCcusage`

Title: `"ccusage Widget: Install / update ccusage globally"`

Behavior:
1. Spawns `npm install -g ccusage` and streams all output to the ccusage Widget output channel, which is shown automatically.
2. On exit code 0: shows VS Code info notification _"ccusage installed successfully."_ and triggers an immediate poll refresh.
3. On non-zero exit: shows VS Code error notification _"ccusage install failed. See the output log for details."_

### ENOENT detection and one-time popup

When any spawn returns an error matching `ENOENT` (binary not on PATH):
- Show a VS Code warning notification (once per session):
  > _"ccusage not found. Install it globally to use this widget."_
  > Buttons: **Install ccusage** | **Dismiss**
- Clicking **Install ccusage** runs `ccusageWidget.installCcusage`.
- The prompt is suppressed for the remainder of the session after the first showing (`notFoundPromptShown` flag), so the poller doesn't spam the user on every tick.
- After a successful install (install command exits 0), the flag resets so the prompt can re-appear if the user uninstalls ccusage in a later session.

The status bar continues to show `$? $(chevron-right)` while ccusage is uninstalled.

## Affected files

| File | Change |
|---|---|
| `package.json` | Update `ccusageCommand` default and description; add `installCcusage` command entry |
| `src/config.ts` | Update `ccusageCommand` default to `"ccusage"` |
| `src/extension.ts` | Add `installCcusage` command handler; add ENOENT detection + one-time popup in `makeRunner` |
| `README.md` | Add Prerequisites section with `npm install -g ccusage` |

No changes to `ccusage.ts`, `poller.ts`, `render.ts`, `cache.ts`, or test files.

## Error states (unchanged)

All other error states (non-zero exit, malformed JSON, buffer overflow) remain as-is. Only the ENOENT case gets the new guided prompt.

## README Prerequisites section

```markdown
## Prerequisites

Install ccusage globally before using this extension:

```sh
npm install -g ccusage
```

If ccusage is not found on your PATH when the extension activates, a prompt will appear with an option to install it automatically.
```
