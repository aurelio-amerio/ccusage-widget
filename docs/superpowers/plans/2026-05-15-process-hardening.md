# Process Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the ccusage subprocess layer so a hung child can't permanently stall the poller, and so rapid config edits can't burst-spawn processes.

**Architecture:**
- Add a watchdog timeout inside `runCcusage` that kills the child (SIGTERM, escalating to SIGKILL) when it exceeds a configurable deadline. Surface this as a structured error so the poller's last-good cache merge keeps working unchanged.
- Stop hot-swapping the `Poller` instance on config changes. Make the runner mutable on the existing instance so command/timezone edits update the runner reference instead of constructing a new poller (which currently fires an immediate refresh on every keystroke through the settings UI).

**Tech Stack:** TypeScript, Node `child_process.spawn`, Vitest fake timers.

---

## File Structure

- `src/ccusage.ts` — extend `RunOptions` with `timeoutMs`; add watchdog inside `runCcusage`.
- `src/ccusage.test.ts` — add tests for the timeout path.
- `src/poller.ts` — add a `setRunner(runner)` method so the runner can be swapped without rebuilding the poller.
- `src/poller.test.ts` — add a test that `setRunner` takes effect on the next refresh without triggering an immediate one.
- `src/extension.ts` — pass a per-call timeout when invoking `runCcusage`; on config change, use `poller.setRunner(...)` instead of stopping/recreating the poller.

No new files. No new dependencies.

---

### Task 1: Add a watchdog timeout to `runCcusage`

**Files:**
- Modify: `src/ccusage.ts:68-111`
- Test: `src/ccusage.test.ts` (append to the existing `describe("runCcusage", ...)` block)

- [ ] **Step 1: Write the failing test**

Append to `src/ccusage.test.ts` inside the existing `describe("runCcusage", ...)` block (before its closing `});`):

```ts
  it("kills the child and returns an error when it exceeds timeoutMs", async () => {
    const start = Date.now();
    const result = await runCcusage({
      command: "node",
      args: ["-e", "setTimeout(() => {}, 60_000)"],
      timeoutMs: 200,
    });
    const elapsed = Date.now() - start;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timeout/i);
    }
    // Must not have waited for the full 60s child sleep.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("does not time out fast-completing children", async () => {
    const result = await runCcusage({
      command: "node",
      args: ["-e", "process.stdout.write('ok')"],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.stdout).toBe("ok");
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run src/ccusage.test.ts -t "timeoutMs|fast-completing"`
Expected: First test FAILS (no timeout — it would hang or report ok); second test currently passes since the option is ignored. Both must exist; the first proves the bug, the second guards the happy path.

- [ ] **Step 3: Extend `RunOptions` and implement the watchdog**

Replace the `RunOptions` interface and the body of `runCcusage` in `src/ccusage.ts` (lines 68-111) with:

```ts
export interface RunOptions {
  command: string;
  args: string[];
  maxBufferBytes?: number;
  timeoutMs?: number;
}

export function runCcusage(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const max = opts.maxBufferBytes ?? 8 * 1024 * 1024;
    const timeoutMs = opts.timeoutMs ?? 0;
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const settle = (r: RunResult) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve(r);
    };

    let child;
    try {
      child = spawn(opts.command, opts.args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      settle({ ok: false, exitCode: null, stderr: "", error: (e as Error).message });
      return;
    }

    let killTimer: NodeJS.Timeout | null = null;
    let forceTimer: NodeJS.Timeout | null = null;
    if (timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        // Escalate to SIGKILL if it ignores SIGTERM.
        forceTimer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* ignore */ }
        }, 2_000);
      }, timeoutMs);
    }

    child.stdout?.on("data", (buf: Buffer) => {
      if (stdout.length + buf.length > max) {
        truncated = true;
        return;
      }
      stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      if (stderr.length < max) stderr += buf.toString("utf8");
    });
    child.on("error", (err) => {
      settle({ ok: false, exitCode: null, stderr, error: err.message });
    });
    child.on("close", (code) => {
      if (timedOut) {
        settle({
          ok: false,
          exitCode: code,
          stderr,
          error: `ccusage timed out after ${timeoutMs}ms`,
        });
        return;
      }
      if (truncated) {
        settle({ ok: false, exitCode: code, stderr, error: "stdout exceeded buffer limit" });
        return;
      }
      if (code === 0) settle({ ok: true, stdout });
      else settle({ ok: false, exitCode: code, stderr });
    });
  });
}
```

- [ ] **Step 4: Run the full ccusage test file**

Run: `npx vitest run src/ccusage.test.ts`
Expected: All tests PASS, including the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/ccusage.ts src/ccusage.test.ts
git commit -m "feat: add watchdog timeout to runCcusage"
```

---

### Task 2: Wire the timeout from the extension

**Files:**
- Modify: `src/extension.ts:43-58`

- [ ] **Step 1: Pass `timeoutMs` from `makeRunner`**

In `src/extension.ts`, change the body of `makeRunner` (line 43) so the `runCcusage` call passes a timeout. Replace:

```ts
function makeRunner(cfg: WidgetConfig) {
  const { command, baseArgs } = splitCommand(cfg.ccusageCommand);
  return async (sub: Subcommand) => {
    const args = [...baseArgs, ...buildArgs(sub, cfg)];
    logInfo(`spawn: ${command} ${args.join(" ")}`);
    const result = await runCcusage({ command, args });
```

with:

```ts
const PER_CALL_TIMEOUT_MS = 60_000;

function makeRunner(cfg: WidgetConfig) {
  const { command, baseArgs } = splitCommand(cfg.ccusageCommand);
  return async (sub: Subcommand) => {
    const args = [...baseArgs, ...buildArgs(sub, cfg)];
    logInfo(`spawn: ${command} ${args.join(" ")}`);
    const result = await runCcusage({ command, args, timeoutMs: PER_CALL_TIMEOUT_MS });
```

The rest of `makeRunner` stays the same. Place `const PER_CALL_TIMEOUT_MS = 60_000;` at the top of the file (after the imports, before `let poller`).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: apply 60s timeout to ccusage subprocess calls"
```

---

### Task 3: Make the Poller's runner swappable

**Files:**
- Modify: `src/poller.ts:24-58`
- Test: `src/poller.test.ts` (append a new test in the existing `describe("Poller", ...)`)

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("Poller", ...)` block in `src/poller.test.ts`, before its closing `});`:

```ts
  it("swaps the runner without firing an immediate refresh", async () => {
    const first = makeRunner({ daily: dailyOk, monthly: monthlyOk, blocks: blocksEmpty });
    const second = makeRunner({ daily: dailyOk, monthly: monthlyOk, blocks: blocksEmpty });

    const p = new Poller({ intervalMs: 60_000, runner: first.runner });
    await p.refresh();
    expect(first.runner).toHaveBeenCalledTimes(3);

    p.setRunner(second.runner);
    // Swap alone must not spawn anything.
    expect(second.runner).toHaveBeenCalledTimes(0);

    await p.refresh();
    expect(second.runner).toHaveBeenCalledTimes(3);
    // Old runner is no longer used.
    expect(first.runner).toHaveBeenCalledTimes(3);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/poller.test.ts -t "swaps the runner"`
Expected: FAIL with `p.setRunner is not a function`.

- [ ] **Step 3: Add `setRunner` to the Poller**

In `src/poller.ts`, in the `Poller` class, add this method just after `setInterval(ms: number)` (around line 52):

```ts
  setRunner(runner: Runner): void {
    this.opts.runner = runner;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/poller.test.ts`
Expected: All tests PASS, including the new one.

- [ ] **Step 5: Commit**

```bash
git add src/poller.ts src/poller.test.ts
git commit -m "feat: allow swapping the Poller runner in place"
```

---

### Task 4: Use `setRunner` on config change instead of rebuilding the Poller

**Files:**
- Modify: `src/extension.ts:130-147`

- [ ] **Step 1: Rewrite the config-change handler**

In `src/extension.ts`, replace the `onConfigChange(...)` block (currently lines 130-147) with:

```ts
    onConfigChange((newCfg) => {
      const intervalChanged = newCfg.refreshIntervalMinutes !== cfg.refreshIntervalMinutes;
      const commandChanged =
        newCfg.ccusageCommand !== cfg.ccusageCommand || newCfg.timezone !== cfg.timezone;
      cfg = newCfg;
      if (commandChanged && poller) {
        // Swap the runner in place — no extra spawn, no poller restart.
        poller.setRunner(makeRunner(cfg));
      }
      if (intervalChanged && poller) {
        poller.setInterval(cfg.refreshIntervalMinutes * 60_000);
      }
      renderAll(cfg);
    }),
```

The behavioral change: editing `ccusageCommand` or `timezone` no longer spawns 3 immediate processes per keystroke commit from the settings UI. The next scheduled tick (or a manual refresh) picks up the new runner.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run the whole test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: swap poller runner in place on config change"
```

---

### Task 5: Manual verification

- [ ] **Step 1: Build the extension**

Run: `npm run compile` (or whichever script the repo uses — check `package.json` `scripts` first; the existing build is `esbuild.mjs`).

- [ ] **Step 2: Launch the extension host**

In VS Code, press F5 (Run Extension) to open an Extension Development Host with the widget.

- [ ] **Step 3: Confirm the status bar populates**

Wait up to a few seconds. The status bar item should switch from `Loading…` to a populated cost line. Open the output channel (`ccusage Widget: Show Output`) and confirm three `spawn:` lines logged.

- [ ] **Step 4: Confirm timeout behavior**

In the host's settings, set `ccusageWidget.ccusageCommand` to a hanging command, e.g. `node -e setTimeout(()=>{},600000)`. Wait ~60s. The output log should report a `ccusage timed out after 60000ms` error and the tooltip should show an error string. The poller is not stuck — set the command back to `ccusage` and the next tick (or `ccusage Widget: Refresh`) should recover.

- [ ] **Step 5: Confirm rapid command edits do not burst-spawn**

Set the command back to `ccusage` and edit `ccusageWidget.timezone` rapidly several times in a row. The output log should not show a `spawn:` line for each edit — only the scheduled tick or a manual refresh should produce spawns.

- [ ] **Step 6: Done**

No commit for the manual-verification task itself.
