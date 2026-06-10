import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DailyData, MonthlyData, BlockData } from "./types";
import { todayYMD, thisMonthYM } from "./cache";

const execFileAsync = promisify(execFile);

export interface LoadOpts {
  timezone?: string;
  /** ccusage executable to invoke; defaults to "ccusage" on PATH. */
  command?: string;
}

/** Stable marker so callers can recognise a missing-CLI failure without
 * depending on the (platform-specific) underlying error text. */
export const CCUSAGE_NOT_FOUND_MARKER = "CCUSAGE_NOT_FOUND";

export class CcusageError extends Error {
  constructor(message: string, readonly kind: "not-found" | "failed") {
    super(message);
    this.name = "CcusageError";
  }
}

/** True if the failure is "the ccusage binary isn't on PATH". On POSIX
 * execFile reports ENOENT; under a Windows shell it surfaces as
 * "'ccusage' is not recognized". */
function isCommandMissing(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; stderr?: unknown; message?: unknown };
  if (e.code === "ENOENT") return true;
  const text = `${String(e.stderr ?? "")} ${String(e.message ?? "")}`;
  return /not recognized|command not found|ENOENT/i.test(text);
}

/**
 * ccusage v20 dropped its programmatic library API (no more
 * `ccusage/data-loader` / `ccusage/calculate-cost` subpath exports). The
 * supported, stable interface is now the CLI, so we shell out and parse its
 * `--json` output.
 */
async function runCcusage(subcommand: string, opts: LoadOpts): Promise<unknown> {
  const command = opts.command ?? "ccusage";
  const args = [subcommand, "--json"];
  if (opts.timezone) args.push("--timezone", opts.timezone);

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(command, args, {
      // Usage history can be large; give JSON room to breathe.
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      // On Windows the global binary is a `ccusage.cmd` shim, which execFile
      // cannot resolve without a shell.
      shell: process.platform === "win32",
    }));
  } catch (err) {
    if (isCommandMissing(err)) {
      throw new CcusageError(
        `${CCUSAGE_NOT_FOUND_MARKER}: ccusage CLI not found on PATH. Install it with "npm install -g ccusage".`,
        "not-found",
      );
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new CcusageError(`ccusage ${subcommand} failed: ${detail}`, "failed");
  }

  try {
    return JSON.parse(stdout) as unknown;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new CcusageError(`ccusage ${subcommand} returned invalid JSON: ${detail}`, "failed");
  }
}

interface DailyEntry {
  period: string;
  totalCost: number;
  totalTokens: number;
  modelBreakdowns?: Array<{ modelName: string; cost: number }>;
}

interface MonthlyEntry {
  period: string;
  totalCost: number;
  totalTokens: number;
}

interface BlockEntry {
  isActive: boolean;
  isGap?: boolean;
  costUSD: number;
  endTime: string;
}

export async function fetchToday(opts: LoadOpts): Promise<DailyData> {
  const json = (await runCcusage("daily", opts)) as { daily?: DailyEntry[] };
  const today = todayYMD();
  const entry = (json.daily ?? []).find((d) => d.period === today);
  if (!entry) return { totalCost: 0, totalTokens: 0, modelBreakdowns: [] };
  return {
    totalCost: entry.totalCost,
    totalTokens: entry.totalTokens,
    modelBreakdowns: (entry.modelBreakdowns ?? []).map((b) => ({
      modelName: b.modelName,
      cost: b.cost,
    })),
  };
}

export async function fetchMonth(opts: LoadOpts): Promise<MonthlyData> {
  const json = (await runCcusage("monthly", opts)) as { monthly?: MonthlyEntry[] };
  const ym = thisMonthYM();
  const entry = (json.monthly ?? []).find((m) => m.period === ym);
  if (!entry) return { totalCost: 0, totalTokens: 0 };
  return {
    totalCost: entry.totalCost,
    totalTokens: entry.totalTokens,
  };
}

export async function fetchActiveBlock(opts: LoadOpts): Promise<BlockData | null> {
  const json = (await runCcusage("blocks", opts)) as { blocks?: BlockEntry[] };
  const active = (json.blocks ?? []).find((b) => b.isActive && !b.isGap);
  if (!active) return null;
  const remaining = Math.max(
    0,
    (new Date(active.endTime).getTime() - Date.now()) / 60_000,
  );
  return {
    costUSD: active.costUSD,
    remainingMinutes: Math.round(remaining),
  };
}
