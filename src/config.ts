import * as vscode from "vscode";

export interface WidgetConfig {
  refreshIntervalMinutes: number;
  timezone: string | null;
  showSessionBlock: boolean;
}

export function readConfig(): WidgetConfig {
  const c = vscode.workspace.getConfiguration("ccusageWidget");
  return {
    refreshIntervalMinutes: Math.max(1, c.get<number>("refreshIntervalMinutes", 5)),
    timezone: c.get<string | null>("timezone", null),
    showSessionBlock: c.get<boolean>("showSessionBlock", true),
  };
}

export function onConfigChange(cb: (cfg: WidgetConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("ccusageWidget")) cb(readConfig());
  });
}
