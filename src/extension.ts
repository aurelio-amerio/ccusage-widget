import * as vscode from "vscode";
import { Poller } from "./poller";
import { renderStatusBarText, renderTooltip } from "./render";
import { readConfig, onConfigChange } from "./config";
import type { WidgetConfig } from "./config";
import { getOutputChannel } from "./output";

let poller: Poller | null = null;
let statusBar: vscode.StatusBarItem | null = null;

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
  statusBar.text = "$(clippy) Loading…";
  statusBar.tooltip = "Fetching ccusage data…";
  statusBar.show();

  poller = new Poller({
    intervalMs: cfg.refreshIntervalMinutes * 60_000,
    loadOpts: { timezone: cfg.timezone ?? undefined },
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
      const timezoneChanged = newCfg.timezone !== cfg.timezone;
      cfg = newCfg;
      if (timezoneChanged && poller) {
        poller.setLoadOpts({ timezone: cfg.timezone ?? undefined });
      }
      if (intervalChanged && poller) {
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
