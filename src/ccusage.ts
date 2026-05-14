import type {
  DailyReport,
  MonthlyReport,
  BlocksActiveReport,
  DailyEntry,
  MonthlyEntry,
  ActiveBlock,
} from "./types";

function parseJson(raw: string, kind: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse ccusage ${kind} JSON: ${(e as Error).message}`);
  }
}

export function parseDaily(raw: string): DailyReport {
  const data = parseJson(raw, "daily") as DailyReport;
  if (!data || !Array.isArray(data.daily)) {
    throw new Error("ccusage daily response missing 'daily' array");
  }
  return data;
}

export function parseMonthly(raw: string): MonthlyReport {
  const data = parseJson(raw, "monthly") as MonthlyReport;
  if (!data || !Array.isArray(data.monthly)) {
    throw new Error("ccusage monthly response missing 'monthly' array");
  }
  return data;
}

export function parseBlocksActive(raw: string): BlocksActiveReport {
  const data = parseJson(raw, "blocks") as BlocksActiveReport;
  if (!data || !Array.isArray(data.blocks)) {
    throw new Error("ccusage blocks response missing 'blocks' array");
  }
  return data;
}

export function pickTodayEntry(
  report: DailyReport,
  todayYMD: string,
): DailyEntry | null {
  return report.daily.find((e) => e.date === todayYMD) ?? null;
}

export function pickThisMonthEntry(
  report: MonthlyReport,
  thisYM: string,
): MonthlyEntry | null {
  return report.monthly.find((e) => e.month === thisYM) ?? null;
}

export function pickActiveBlock(
  report: BlocksActiveReport,
): ActiveBlock | null {
  return report.blocks.find((b) => b.isActive && !b.isGap) ?? null;
}

import { spawn } from "node:child_process";

export type RunResult =
  | { ok: true; stdout: string }
  | { ok: false; exitCode: number | null; stderr: string; error?: string };

export interface RunOptions {
  command: string;
  args: string[];
  maxBufferBytes?: number;
}

export function runCcusage(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const max = opts.maxBufferBytes ?? 8 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let truncated = false;

    let child;
    try {
      child = spawn(opts.command, opts.args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ ok: false, exitCode: null, stderr: "", error: (e as Error).message });
      return;
    }

    child.stdout.on("data", (buf: Buffer) => {
      if (stdout.length + buf.length > max) {
        truncated = true;
        return;
      }
      stdout += buf.toString("utf8");
    });
    child.stderr.on("data", (buf: Buffer) => {
      if (stderr.length < max) stderr += buf.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ ok: false, exitCode: null, stderr, error: err.message });
    });
    child.on("close", (code) => {
      if (truncated) {
        resolve({ ok: false, exitCode: code, stderr, error: "stdout exceeded buffer limit" });
        return;
      }
      if (code === 0) resolve({ ok: true, stdout });
      else resolve({ ok: false, exitCode: code, stderr });
    });
  });
}

export function splitCommand(commandString: string): { command: string; baseArgs: string[] } {
  const parts = commandString.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    throw new Error("ccusageCommand is empty");
  }
  return { command: parts[0], baseArgs: parts.slice(1) };
}
