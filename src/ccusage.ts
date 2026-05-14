import {
  loadDailyUsageData,
  loadMonthlyUsageData,
  loadSessionBlockData,
} from "ccusage/data-loader";
import { getTotalTokens } from "ccusage/calculate-cost";
import type { DailyData, MonthlyData, BlockData } from "./types";
import { todayYMD, thisMonthYM } from "./cache";

export interface LoadOpts {
  timezone?: string;
}

export async function fetchToday(opts: LoadOpts): Promise<DailyData> {
  const days = await loadDailyUsageData({
    timezone: opts.timezone ?? undefined,
  });
  const today = todayYMD();
  const entry = days.find((d) => d.date === today);
  if (!entry) return { totalCost: 0, totalTokens: 0, modelBreakdowns: [] };
  return {
    totalCost: entry.totalCost,
    totalTokens: getTotalTokens(entry),
    modelBreakdowns: entry.modelBreakdowns.map((b) => ({
      modelName: b.modelName,
      cost: b.cost,
    })),
  };
}

export async function fetchMonth(opts: LoadOpts): Promise<MonthlyData> {
  const months = await loadMonthlyUsageData({
    timezone: opts.timezone ?? undefined,
  });
  const ym = thisMonthYM();
  const entry = months.find((m) => m.month === ym);
  if (!entry) return { totalCost: 0, totalTokens: 0 };
  return {
    totalCost: entry.totalCost,
    totalTokens: getTotalTokens(entry),
  };
}

export async function fetchActiveBlock(opts: LoadOpts): Promise<BlockData | null> {
  const blocks = await loadSessionBlockData({
    timezone: opts.timezone ?? undefined,
  });
  const active = blocks.find((b) => b.isActive && !b.isGap);
  if (!active) return null;
  const remaining = Math.max(0, (active.endTime.getTime() - Date.now()) / 60_000);
  return {
    costUSD: active.costUSD,
    remainingMinutes: Math.round(remaining),
  };
}
