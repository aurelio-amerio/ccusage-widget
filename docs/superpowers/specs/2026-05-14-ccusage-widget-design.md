# ccusage-widget — Design

**Date:** 2026-05-14
**Status:** Approved for planning
**Scope:** v1 — ccusage spend data only. Plan-quota integration is deferred to a future iteration.

## Summary

A small VS Code extension that displays Claude Code usage cost in the status bar (right side) and shows a richer breakdown in the built-in tooltip on hover. Data is sourced exclusively by spawning `npx ccusage@latest <subcommand> --json` and parsing the result.

## Goals

- At-a-glance view of today's Claude spend without leaving the editor.
- One-click access to today / this-month / active-session-block detail.
- Zero configuration for the common case (`npx ccusage@latest` works out of the box).
- No external dependencies beyond ccusage and the VS Code API. No webview, no HTTP, no auth.

## Non-goals (v1)

- Plan-quota tracking (% remaining for 5h / weekly / weekly-Sonnet caps). Requires reading Claude Code OAuth credentials and calling `api.anthropic.com/api/oauth/usage`. Out of scope here; revisit later as a separate spec.
- Charts, history graphs, multi-day trend views.
- Per-project filtering UI (the underlying `--project` ccusage flag exists; we won't expose it yet).
- Webview-based detail panel.

## User-visible behavior

### Status bar item

- Position: right side, high priority so it sits toward the end of the right cluster.
- Default text: `$4.27 $(chevron-right)` — today's cost plus VS Code's built-in `search` codicon as the magnifying-glass affordance.
- Click: runs `ccusageWidget.refresh` (manual refresh; tooltip already auto-shows on hover, per VS Code conventions).
- States:
  - Loading (first poll not yet returned): `Loading… $(chevron-right)`
  - Stale (last poll failed but cache exists): keep last-known cost; tooltip explains staleness.
  - Hard failure (no cache yet): `$? $(chevron-right)` with retry link in tooltip.

### Tooltip (MarkdownString, `isTrusted = true`)

Rendered from the in-memory cache; rebuilt whenever the cache updates. Sections are omitted when their underlying data is unavailable.

```
### Claude Code Usage

**Today** — $4.27 · 1.24M tok
  Opus $3.10 · Sonnet $1.17

**This month** — $82.40 · 24.89M tok

**Active session block (5h)** — $1.85
Started 1h 23m ago · 3h 37m remaining

---
Last updated 14:32 · [Refresh](command:ccusageWidget.refresh)
```

Per-model breakdown shown inline on the "Today" line when ≤3 models have non-zero spend; otherwise folded into a sub-list. The session-block section is suppressed entirely when no active block is returned, or when `showSessionBlock` setting is `false`.

## Architecture

Single extension, no separate processes beyond ccusage child invocations.

### Modules

| File | Responsibility |
|---|---|
| `src/extension.ts` | Activation (`onStartupFinished`), status bar item creation, command registration, dispose lifecycle. Wires the poller's `onUpdate` event to a render call. |
| `src/ccusage.ts` | Typed wrapper around `npx ccusage@latest`. One function per subcommand used: `runDaily()`, `runMonthly()`, `runBlocksActive()`. Each spawns the child process, captures stdout, parses JSON, returns a typed object. Errors are returned, not thrown, so the poller can decide what to do. |
| `src/poller.ts` | Interval scheduler. Exposes `start()`, `stop()`, `refresh()`, and an `onUpdate` emitter. Coalesces in-flight requests so a manual refresh during a poll doesn't double-spawn. Uses `Promise.allSettled` across the three subcommand calls — one failure doesn't blank the others. |
| `src/render.ts` | Pure functions: `renderStatusBarText(cache)` → `string`, `renderTooltip(cache)` → `MarkdownString`. No side effects, no VS Code globals beyond `MarkdownString`. Easily unit-testable. |
| `src/cache.ts` | In-memory cache type and timestamp bookkeeping. No disk persistence in v1. |
| `src/config.ts` | Reads `ccusageWidget.*` settings with defaults; emits change events so the poller can pick up interval changes. |
| `src/output.ts` | Wraps a `vscode.OutputChannel` for diagnostic logging (errors, child-process stderr). |

### Data flow per poll tick

1. `poller.refresh()` is called (by interval timer or user command).
2. If a poll is already in flight, return the existing promise (coalescing).
3. Spawn three child processes in parallel via `ccusage.ts`:
   - `ccusage daily --json --since <today-YYYYMMDD> --breakdown`
   - `ccusage monthly --json --since <this-month-YYYYMM> --breakdown`
   - `ccusage blocks --json --active`
4. `Promise.allSettled` on all three. For each settled result, update the corresponding slot in the cache with `{data, fetchedAt}` on success, or `{error, fetchedAt, lastGood}` on failure (lastGood preserved from prior cache).
5. Emit `onUpdate`. `extension.ts` recomputes status bar text and tooltip from the cache.

### Process invocation details

- Command construction: `${ccusageCommand} ${subcommand} --json ...`, where `ccusageCommand` defaults to `npx ccusage@latest` and is shell-split safely (no shell interpolation; use `child_process.spawn` with an argv array; tokenize the configured string with a simple whitespace split since values are user-controlled).
- Timezone: if `ccusageWidget.timezone` is set, append `--timezone <value>`.
- Stdout buffered up to a generous limit (e.g. 4 MB); stderr captured to the output channel.
- Non-zero exit code or unparseable JSON → error result with the captured stderr included.
- First invocation can be slow (npx downloads the package). The widget shows `Loading…` until the first successful poll; there is no special timeout — we wait for npx to finish.

## Configuration

All settings under the `ccusageWidget` namespace, contributed via `package.json`.

| Setting | Type | Default | Description |
|---|---|---|---|
| `refreshIntervalMinutes` | number, min 1 | `5` | How often the background poller runs. |
| `ccusageCommand` | string | `"npx ccusage@latest"` | Command used to invoke ccusage. Override to `"ccusage"` for a globally-installed binary. |
| `timezone` | string \| null | `null` | Optional IANA timezone forwarded to ccusage `--timezone`. |
| `showSessionBlock` | boolean | `true` | Whether to include the active 5h block section in the tooltip. |

Settings changes are picked up live; `refreshIntervalMinutes` changes restart the poll timer.

## Commands

| Command ID | Title | Default binding |
|---|---|---|
| `ccusageWidget.refresh` | "ccusage Widget: Refresh now" | Status bar click |
| `ccusageWidget.showOutput` | "ccusage Widget: Show output log" | — |

## Error handling

| Condition | Status bar | Tooltip |
|---|---|---|
| First poll in progress, no cache | `Loading… $(chevron-right)` | "Fetching ccusage data…" |
| All three calls failed, no prior cache | `$? $(chevron-right)` | Error message + `[Retry]` link + hint to set `ccusageCommand` |
| Some calls failed, others succeeded | Last-known cost displayed | Successful sections rendered normally; failed sections show `—` with a small error icon and timestamp |
| ccusage missing / spawn ENOENT | `$? $(chevron-right)` | Explicit "Could not run ccusage" message with config hint |

Diagnostic detail (child-process stderr, parse errors, stack traces) goes to the extension's output channel, not the tooltip.

## Testing

Test runner: `vitest`. All production code lives in `src/`, tests in `src/**/*.test.ts`. Fixture JSON files for ccusage outputs in `src/__fixtures__/`.

| Module | Test approach |
|---|---|
| `render.ts` | Pure-function tests against multiple `CacheState` fixtures: full data, missing block, mixed errors, zero spend, many models. Assert exact strings for status bar text and snapshot the tooltip markdown. |
| `ccusage.ts` | Parse fixture stdout for each subcommand; assert typed result shape. Error cases: malformed JSON, non-zero exit, ENOENT. Child-process spawning is mocked. |
| `poller.ts` | Vitest fake timers. Verify interval scheduling, coalescing (two `refresh()` calls during one in-flight poll → one spawn set), and partial-failure cache merging. |
| `config.ts` | Trivial; not separately tested unless logic grows. |

No integration tests against real ccusage in CI — those would require pre-seeded Claude logs. Fixture capture script (`scripts/capture-fixtures.sh`) runs locally on demand to refresh fixtures when ccusage's JSON shape evolves.

## File layout

```
ccusage-widget/
├── package.json                # extension manifest
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── extension.ts
│   ├── ccusage.ts
│   ├── poller.ts
│   ├── render.ts
│   ├── cache.ts
│   ├── config.ts
│   ├── output.ts
│   ├── __fixtures__/
│   │   ├── daily.json
│   │   ├── monthly.json
│   │   └── blocks-active.json
│   └── **/*.test.ts
├── reference-mhelbich/         # cloned for reference, not shipped
└── docs/superpowers/specs/
    └── 2026-05-14-ccusage-widget-design.md
```

`reference-mhelbich/` is kept on disk for future reference (when we revisit quota integration) but is excluded from the bundled extension via `.vscodeignore`.

## Open questions

None blocking implementation. The exact JSON shape of `ccusage daily/monthly/blocks --json` will be confirmed by capturing fixtures during the first implementation step; the spec assumes the shape documented in ccusage's own README/source.
