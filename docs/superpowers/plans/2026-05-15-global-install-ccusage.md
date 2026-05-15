# Global Install ccusage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `npx ccusage@latest` with a direct call to a globally-installed `ccusage` binary, with a one-time popup guiding users to install it when it is missing.

**Architecture:** Four small changes: (1) update the manifest default and add the `installCcusage` command declaration in `package.json`, (2) update the `ccusageCommand` default in `src/config.ts`, (3) add ENOENT detection + one-time popup + `installCcusage` handler in `src/extension.ts`, (4) add a Prerequisites section to `README.md`. No new modules needed; the logic fits naturally inside `extension.ts` which wires everything together.

**Tech Stack:** TypeScript 5, VS Code Extension API, Node `child_process.spawn` (already used by `runCcusage`).

**Spec:** `docs/superpowers/specs/2026-05-15-global-install-ccusage-design.md`

**Prerequisite tasks from the original plan that must be complete first:**
- Task 5 (cache.ts), Task 6 (render.ts), Task 7 (config.ts + output.ts), Task 8 (poller.ts) from `docs/superpowers/plans/2026-05-14-ccusage-widget.md`
- This plan **supersedes Task 9** (extension.ts) from that plan — do not implement Task 9 from the old plan; use this plan instead.

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `package.json` | Modify | Update `ccusageCommand` default + description; add `installCcusage` command entry |
| `src/config.ts` | Modify | Update `ccusageCommand` fallback default from `"npx ccusage@latest"` to `"ccusage"` |
| `src/extension.ts` | Create | Activation entry point — wires status bar, poller, commands including `installCcusage`, and ENOENT detection |
| `README.md` | Modify | Add Prerequisites section |

---

## Task 1: Update package.json manifest

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `ccusageCommand` default and description**

In `package.json`, find the `ccusageWidget.ccusageCommand` property and replace it:

```json
"ccusageWidget.ccusageCommand": {
  "type": "string", "default": "ccusage",
  "description": "Command used to invoke ccusage. Must be installed globally: npm install -g ccusage"
}
```

- [ ] **Step 2: Add the `installCcusage` command declaration**

In the `contributes.commands` array, append:

```json
{ "command": "ccusageWidget.installCcusage", "title": "ccusage Widget: Install / update ccusage globally" }
```

The full `commands` array should now be:

```json
"commands": [
  { "command": "ccusageWidget.refresh", "title": "ccusage Widget: Refresh now" },
  { "command": "ccusageWidget.showOutput", "title": "ccusage Widget: Show output log" },
  { "command": "ccusageWidget.installCcusage", "title": "ccusage Widget: Install / update ccusage globally" }
]
```

- [ ] **Step 3: Verify no test breakage**

Run: `npm test`
Expected: all tests pass (no test touches the manifest).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: change ccusageCommand default to 'ccusage' and add installCcusage command"
```

---

## Task 2: Update src/config.ts default

**Files:**
- Modify: `src/config.ts`

`src/config.ts` should already exist from the original plan (Task 7). If it does not yet exist, create it now with the full content below.

- [ ] **Step 1: Change the `ccusageCommand` default**

In `src/config.ts`, find the `readConfig` function and update the `ccusageCommand` line:

```typescript
ccusageCommand: c.get<string>("ccusageCommand", "ccusage"),
```

If `src/config.ts` does not exist yet, create it in full:

```typescript
import * as vscode from "vscode";

export interface WidgetConfig {
  refreshIntervalMinutes: number;
  ccusageCommand: string;
  timezone: string | null;
  showSessionBlock: boolean;
}

export function readConfig(): WidgetConfig {
  const c = vscode.workspace.getConfiguration("ccusageWidget");
  return {
    refreshIntervalMinutes: Math.max(1, c.get<number>("refreshIntervalMinutes", 5)),
    ccusageCommand: c.get<string>("ccusageCommand", "ccusage"),
    timezone: c.get<string | null>("timezone", null),
    showSessionBlock: c.get<boolean>("showSessionBlock", true),
  };
}

export function onConfigChange(cb: (cfg: WidgetConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("ccusageWidget")) cb(readConfig());
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: update ccusageCommand default to 'ccusage'"
```

---

## Task 3: Write src/extension.ts with global-install feature

**Files:**
- Create: `src/extension.ts`

This is the main task. It wires together all modules AND adds:
- `installCcusage` command that runs `npm install -g ccusage`
- ENOENT detection in `makeRunner` that shows a one-time popup

**Prerequisite:** `src/cache.ts`, `src/render.ts`, `src/config.ts`, `src/output.ts`, `src/poller.ts` must all exist before this step.

- [ ] **Step 1: Create `src/extension.ts`**

```typescript
import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { Poller } from "./poller";
import type { Subcommand } from "./poller";
import { runCcusage, splitCommand } from "./ccusage";
import { renderStatusBarText, renderTooltip } from "./render";
import { readConfig, onConfigChange } from "./config";
import type { WidgetConfig } from "./config";
import { logError, logInfo, getOutputChannel } from "./output";

let poller: Poller | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let notFoundPromptShown = false;

function buildArgs(sub: Subcommand, cfg: WidgetConfig): string[] {
  const args = [sub, "--json"];
  if (sub === "daily" || sub === "monthly") args.push("--breakdown");
  if (sub === "blocks") args.push("--active");
  if (cfg.timezone) args.push("--timezone", cfg.timezone);
  return args;
}

function isNotFound(error: string): boolean {
  return /ENOENT|not found|command not found/i.test(error);
}

function showNotFoundPrompt(): void {
  if (notFoundPromptShown) return;
  notFoundPromptShown = true;
  void vscode.window
    .showWarningMessage(
      "ccusage not found. Install it globally to use this widget.",
      "Install ccusage",
      "Dismiss",
    )
    .then((choice) => {
      if (choice === "Install ccusage") {
        void vscode.commands.executeCommand("ccusageWidget.installCcusage");
      }
    });
}

function makeRunner(cfg: WidgetConfig) {
  const { command, baseArgs } = splitCommand(cfg.ccusageCommand);
  return async (sub: Subcommand) => {
    const args = [...baseArgs, ...buildArgs(sub, cfg)];
    logInfo(`spawn: ${command} ${args.join(" ")}`);
    const result = await runCcusage({ command, args });
    if (!result.ok) {
      const errMsg = result.error ?? result.stderr ?? `exit ${result.exitCode}`;
      logError(`ccusage ${sub} failed`, errMsg);
      if (result.error && isNotFound(result.error)) {
        showNotFoundPrompt();
      }
    }
    return result;
  };
}

function renderAll(cfg: WidgetConfig) {
  if (!statusBar || !poller) return;
  const cache = poller.getCache();
  statusBar.text = renderStatusBarText(cache);
  statusBar.tooltip = renderTooltip(cache, { showSessionBlock: cfg.showSessionBlock });
}

async function runInstall(outputChannel: vscode.OutputChannel): Promise<boolean> {
  return new Promise((resolve) => {
    outputChannel.show(true);
    outputChannel.appendLine(`[${new Date().toISOString()}] Running: npm install -g ccusage`);

    const child = spawn("npm", ["install", "-g", "ccusage"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (buf: Buffer) => outputChannel.append(buf.toString("utf8")));
    child.stderr.on("data", (buf: Buffer) => outputChannel.append(buf.toString("utf8")));

    child.on("error", (err) => {
      outputChannel.appendLine(`[error] ${err.message}`);
      resolve(false);
    });

    child.on("close", (code) => {
      outputChannel.appendLine(
        `[${new Date().toISOString()}] npm install exited with code ${code}`,
      );
      resolve(code === 0);
    });
  });
}

export function activate(context: vscode.ExtensionContext): void {
  let cfg = readConfig();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "ccusageWidget.refresh";
  statusBar.text = "Loading… $(chevron-right)";
  statusBar.tooltip = "Fetching ccusage data…";
  statusBar.show();

  poller = new Poller({
    intervalMs: cfg.refreshIntervalMinutes * 60_000,
    runner: makeRunner(cfg),
  });

  poller.onUpdate(() => renderAll(cfg));
  poller.start();

  context.subscriptions.push(
    statusBar,
    vscode.commands.registerCommand("ccusageWidget.refresh", () => {
      void poller?.refresh();
    }),
    vscode.commands.registerCommand("ccusageWidget.showOutput", () => {
      getOutputChannel().show();
    }),
    vscode.commands.registerCommand("ccusageWidget.installCcusage", async () => {
      const ok = await runInstall(getOutputChannel());
      if (ok) {
        notFoundPromptShown = false;
        void vscode.window.showInformationMessage("ccusage installed successfully.");
        void poller?.refresh();
      } else {
        void vscode.window.showErrorMessage(
          "ccusage install failed. See the output log for details.",
        );
      }
    }),
    onConfigChange((newCfg) => {
      const intervalChanged = newCfg.refreshIntervalMinutes !== cfg.refreshIntervalMinutes;
      const commandChanged =
        newCfg.ccusageCommand !== cfg.ccusageCommand || newCfg.timezone !== cfg.timezone;
      cfg = newCfg;
      if (commandChanged && poller) {
        poller.stop();
        poller = new Poller({
          intervalMs: cfg.refreshIntervalMinutes * 60_000,
          runner: makeRunner(cfg),
        });
        poller.onUpdate(() => renderAll(cfg));
        poller.start();
      } else if (intervalChanged && poller) {
        poller.setInterval(cfg.refreshIntervalMinutes * 60_000);
      }
      renderAll(cfg);
    }),
    { dispose: () => poller?.stop() },
  );
}

export function deactivate(): void {
  poller?.stop();
  poller = null;
  statusBar?.dispose();
  statusBar = null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `src/output.ts` is missing, create it now:

```typescript
import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel("ccusage Widget");
  return channel;
}

export function logError(prefix: string, err: unknown): void {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${prefix}: ${msg}`);
}

export function logInfo(msg: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${msg}`);
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all existing tests pass (extension.ts has no unit tests — it is verified manually in Task 4).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `dist/extension.js` produced; no errors.

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/output.ts
git commit -m "feat: wire extension with global ccusage, ENOENT prompt, and install command"
```

---

## Task 4: Manual verification in Extension Development Host

**Files:** none — verification only.

- [ ] **Step 1: Launch Extension Development Host**

Press F5 in VS Code (or run "Run Extension" from the debug panel). A second VS Code window opens.

- [ ] **Step 2: Verify happy path**

In the new window, check the bottom-right status bar. If `ccusage` is installed globally, the widget should show today's cost within a few seconds. Hover — tooltip should show Today, This month, and (if applicable) Active session block sections.

- [ ] **Step 3: Verify ENOENT prompt**

Set `ccusageWidget.ccusageCommand` to `definitely-not-installed-xyz` in the extension dev host's settings. Wait for the next poll (or run "ccusage Widget: Refresh now"). A warning popup should appear:
> _"ccusage not found. Install it globally to use this widget."_
> Buttons: **Install ccusage** | **Dismiss**

Dismiss it. Run Refresh again — the popup should NOT appear a second time (one-per-session suppression).

Reset `ccusageWidget.ccusageCommand` to default after testing.

- [ ] **Step 4: Verify installCcusage command**

Run "ccusage Widget: Install / update ccusage globally" from the Command Palette. The output channel should open and show `npm install -g ccusage` output. On success, an info notification appears and the widget refreshes.

- [ ] **Step 5: Commit launch config if not already committed**

If `.vscode/launch.json` does not exist:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

If `.vscode/tasks.json` does not exist:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "npm: build",
      "type": "npm",
      "script": "build",
      "problemMatcher": ["$tsc"]
    }
  ]
}
```

```bash
git add .vscode/launch.json .vscode/tasks.json
git commit -m "chore: add VS Code launch and build tasks"
```

---

## Task 5: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Prerequisites section**

Replace the contents of `README.md` with:

```markdown
# ccusage-widget

A VS Code extension that shows today's Claude Code spend in the status bar and reveals a daily / monthly / active-session-block breakdown on hover.

## Prerequisites

Install ccusage globally before using this extension:

```sh
npm install -g ccusage
```

If ccusage is not found on your PATH when the extension activates, a prompt will appear with an option to install it automatically. You can also run it manually via the Command Palette:

> **ccusage Widget: Install / update ccusage globally**

## Usage

Once installed and ccusage is on your PATH, the widget activates automatically. The status bar item shows today's cost (`$4.27 $(chevron-right)`). Click it to force a refresh. Hover for a full breakdown.

### Settings

| Setting | Default | Description |
|---|---|---|
| `ccusageWidget.ccusageCommand` | `"ccusage"` | Binary to invoke. Override if ccusage is installed at a non-standard path. |
| `ccusageWidget.refreshIntervalMinutes` | `5` | How often to poll for fresh data. |
| `ccusageWidget.timezone` | `null` | IANA timezone passed to `ccusage --timezone`. |
| `ccusageWidget.showSessionBlock` | `true` | Show the active 5h session block in the tooltip. |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add Prerequisites and usage sections to README"
```

---

## Definition of Done

- [ ] `package.json` `ccusageCommand` default is `"ccusage"` and `installCcusage` command is declared
- [ ] `src/config.ts` `ccusageCommand` default is `"ccusage"`
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run build` produces `dist/extension.js`
- [ ] Status bar shows today's cost when ccusage is installed
- [ ] Setting an invalid command triggers a one-time warning popup with **Install ccusage** button
- [ ] Running "ccusage Widget: Install / update ccusage globally" from Command Palette installs ccusage and refreshes the widget
- [ ] README has a Prerequisites section with `npm install -g ccusage`