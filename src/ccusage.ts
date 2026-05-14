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
