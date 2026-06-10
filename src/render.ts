import * as vscode from "vscode";
import type { CacheState } from "./cache";
import { formatHHMM } from "./cache";
import type { ModelBreakdown } from "./types";

export interface RenderOptions {
  showSessionBlock?: boolean;
}

export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function renderStatusBarText(cache: CacheState): string {
  if (cache.today.data) return `$(chevron-right) ${formatCost(cache.today.data.totalCost)}`;
  if (cache.today.error && !cache.today.data) return `$(chevron-right) $?`;
  return `$(chevron-right) Loading…`;
}

function shortModelName(name: string): string {
  const m = name.match(/claude-(opus|sonnet|haiku)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : name;
}

function renderModelLine(breakdowns: ModelBreakdown[]): string {
  const nonZero = breakdowns.filter((b) => b.cost > 0);
  if (nonZero.length === 0) return "";
  const parts = nonZero
    .sort((a, b) => b.cost - a.cost)
    .map((b) => `${shortModelName(b.modelName)} ${formatCost(b.cost)}`);
  return parts.join(" · ");
}

function renderTodaySection(s: CacheState["today"]): string {
  if (s.error && !s.data) {
    return `**Today** — _unavailable: ${s.error}_`;
  }
  if (!s.data) return `**Today** — _loading…_`;
  const d = s.data;
  const breakdown = renderModelLine(d.modelBreakdowns);
  const head = `**Today** — ${formatCost(d.totalCost)} · ${formatTokens(d.totalTokens)} tok`;
  return breakdown ? `${head}\n\n${breakdown}` : head;
}

function renderMonthSection(s: CacheState["thisMonth"]): string {
  if (s.error && !s.data) return `**This month** — _unavailable: ${s.error}_`;
  if (!s.data) return `**This month** — _loading…_`;
  const m = s.data;
  return `**This month** — ${formatCost(m.totalCost)} · ${formatTokens(m.totalTokens)} tok`;
}

function renderBlockSection(s: CacheState["activeBlock"]): string | null {
  if (s.error && !s.data) return `**Active session block (5h)** — _unavailable: ${s.error}_`;
  if (!s.data) return null;
  const b = s.data;
  const head = `**Active session block (5h)** — ${formatCost(b.costUSD)}`;
  if (b.remainingMinutes != null) {
    const h = Math.floor(b.remainingMinutes / 60);
    const m = b.remainingMinutes % 60;
    return `${head}\n\n${h}h ${m}m remaining`;
  }
  return head;
}

export function renderTooltip(cache: CacheState, opts: RenderOptions = {}): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportThemeIcons = true;

  if (!cache.lastUpdated && !cache.today.error) {
    md.appendMarkdown("### Claude Code Usage\n\n_Fetching ccusage data…_");
    return md;
  }

  const lines: string[] = ["### Claude Code Usage", ""];
  lines.push(renderTodaySection(cache.today), "");
  lines.push(renderMonthSection(cache.thisMonth), "");

  if (opts.showSessionBlock !== false) {
    const block = renderBlockSection(cache.activeBlock);
    if (block) lines.push(block, "");
  }

  lines.push("---");
  const updated = cache.lastUpdated ? formatHHMM(cache.lastUpdated) : "—";
  lines.push(`Last updated ${updated} · [Refresh](command:ccusageWidget.refresh)`);

  md.appendMarkdown(lines.join("\n"));
  return md;
}
