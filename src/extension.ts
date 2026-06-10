import * as vscode from "vscode";
import { Poller } from "./poller";
import { renderStatusBarText, renderTooltip } from "./render";
import { readConfig, onConfigChange } from "./config";
import type { WidgetConfig } from "./config";
import { getOutputChannel, logInfo } from "./output";
import { CCUSAGE_NOT_FOUND_MARKER } from "./ccusage";
import type { CacheState } from "./cache";

let poller: Poller | null = null;
let statusBar: vscode.StatusBarItem | null = null;
let promptedInstall = false;

function renderAll(cfg: WidgetConfig) {
  if (!statusBar || !poller) return;
  const cache = poller.getCache();
  statusBar.text = renderStatusBarText(cache);
  statusBar.tooltip = renderTooltip(cache, { showSessionBlock: cfg.showSessionBlock });
  reportErrors(cache);
}

function sectionErrors(cache: CacheState): string[] {
  return [cache.today.error, cache.thisMonth.error, cache.activeBlock.error].filter(
    (e): e is string => e != null,
  );
}

/** Surface fetch failures: log them, and if ccusage is missing, offer to install it. */
function reportErrors(cache: CacheState): void {
  const errors = sectionErrors(cache);
  for (const e of errors) logInfo(`fetch error: ${e}`);

  const notFound = errors.some((e) => e.includes(CCUSAGE_NOT_FOUND_MARKER));
  if (!notFound) {
    promptedInstall = false; // reset once ccusage is reachable again
    return;
  }
  if (promptedInstall) return;
  promptedInstall = true;

  void vscode.window
    .showErrorMessage(
      "ccusage CLI was not found on your PATH. Install it to show usage.",
      "Install ccusage",
      "Show log",
    )
    .then((choice) => {
      if (choice === "Install ccusage") {
        void vscode.commands.executeCommand("ccusageWidget.installCcusage");
      } else if (choice === "Show log") {
        getOutputChannel().show();
      }
    });
}

function installCcusage(): void {
  const terminal = vscode.window.createTerminal("Install ccusage");
  terminal.show();
  terminal.sendText("npm install -g ccusage@latest");
  void vscode.window.showInformationMessage(
    "Installing ccusage in a terminal. Once it finishes, the widget will pick it up on the next refresh.",
  );
}

export function activate(context: vscode.ExtensionContext): void {
  let cfg = readConfig();

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = "ccusageWidget.refresh";
  statusBar.text = "$(chevron-right) Loading…";
  statusBar.tooltip = "Fetching ccusage data…";
  statusBar.show();

  poller = new Poller({
    intervalMs: cfg.refreshIntervalMinutes * 60_000,
    loadOpts: { timezone: cfg.timezone ?? undefined, command: cfg.ccusageCommand },
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
    vscode.commands.registerCommand("ccusageWidget.installCcusage", () => {
      installCcusage();
    }),
    onConfigChange((newCfg) => {
      const intervalChanged = newCfg.refreshIntervalMinutes !== cfg.refreshIntervalMinutes;
      const loadOptsChanged =
        newCfg.timezone !== cfg.timezone || newCfg.ccusageCommand !== cfg.ccusageCommand;
      cfg = newCfg;
      if (loadOptsChanged && poller) {
        poller.setLoadOpts({ timezone: cfg.timezone ?? undefined, command: cfg.ccusageCommand });
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
