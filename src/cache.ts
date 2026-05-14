import type { DailyData, MonthlyData, BlockData } from "./types";

export interface SectionState<T> {
  data: T | null;
  error: string | null;
  fetchedAt: Date | null;
}

export interface CacheState {
  today: SectionState<DailyData>;
  thisMonth: SectionState<MonthlyData>;
  activeBlock: SectionState<BlockData>;
  lastUpdated: Date | null;
}

const emptySection = <T>(): SectionState<T> => ({ data: null, error: null, fetchedAt: null });

export function emptyCache(): CacheState {
  return {
    today: emptySection(),
    thisMonth: emptySection(),
    activeBlock: emptySection(),
    lastUpdated: null,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function todayYMD(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function thisMonthYM(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function formatHHMM(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
