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
  statusBar.text = "Loading… $(search)";
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
