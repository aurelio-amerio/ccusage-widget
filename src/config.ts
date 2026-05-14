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
    ccusageCommand: c.get<string>("ccusageCommand", "npx ccusage@latest"),
    timezone: c.get<string | null>("timezone", null),
    showSessionBlock: c.get<boolean>("showSessionBlock", true),
  };
}

export function onConfigChange(cb: (cfg: WidgetConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("ccusageWidget")) cb(readConfig());
  });
}
