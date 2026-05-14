import * as vscode from "vscode";
import { Poller } from "./poller";
import type { Subcommand } from "./poller";
import { runCcusage, splitCommand } from "./ccusage";
import { renderStatusBarText, renderTooltip } from "./render";
import { readConfig, onConfigChange } from "./config";
import type { WidgetConfig } from "./config";
import { logError, logInfo, getOutputChannel } from "./output";

let poller: Poller | null = null;
let statusBar: vscode.StatusBarItem | null = null;

function buildArgs(sub: Subcommand, cfg: WidgetConfig): string[] {
  const args = [sub, "--json"];
  if (sub === "daily" || sub === "monthly") args.push("--breakdown");
  if (sub === "blocks") args.push("--active");
  if (cfg.timezone) args.push("--timezone", cfg.timezone);
  return args;
}

function makeRunner(cfg: WidgetConfig) {
  const { command, baseArgs } = splitCommand(cfg.ccusageCommand);
  return async (sub: Subcommand) => {
    const args = [...baseArgs, ...buildArgs(sub, cfg)];
    logInfo(`spawn: ${command} ${args.join(" ")}`);
    const result = await runCcusage({ command, args });
    if (!result.ok) {
      const tail = result.stderr ? ` — ${result.stderr.split("\n").slice(0, 3).join(" ")}` : "";
      logError(`ccusage ${sub} failed`, `${result.error ?? `exit ${result.exitCode}`}${tail}`);
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
    onConfigChange((newCfg) => {
      const intervalChanged = newCfg.refreshIntervalMinutes !== cfg.refreshIntervalMinutes;
      const commandChanged = newCfg.ccusageCommand !== cfg.ccusageCommand
        || newCfg.timezone !== cfg.timezone;
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
