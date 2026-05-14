import * as vscode from "vscode";

let channel: vscode.OutputChannel | null = null;

export function getOutputChannel(): vscode.OutputChannel {
  if (!channel) channel = vscode.window.createOutputChannel("ccusage Widget");
  return channel;
}

export function logError(prefix: string, err: unknown): void {
  const c = getOutputChannel();
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  c.appendLine(`[${new Date().toISOString()}] ${prefix}: ${msg}`);
}

export function logInfo(msg: string): void {
  getOutputChannel().appendLine(`[${new Date().toISOString()}] ${msg}`);
}
