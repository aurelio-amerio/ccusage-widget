export interface ModelBreakdown {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
}

export interface DailyEntry {
  date: string; // "YYYY-MM-DD"
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
}

export interface MonthlyEntry {
  month: string; // "YYYY-MM"
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  totalCost: number;
  modelsUsed: string[];
  modelBreakdowns: ModelBreakdown[];
}

export interface DailyReport {
  daily: DailyEntry[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    totalCost: number;
  };
}

export interface MonthlyReport {
  monthly: MonthlyEntry[];
  totals: DailyReport["totals"];
}

export interface ActiveBlock {
  id: string;
  startTime: string; // ISO8601
  endTime: string;
  actualEndTime?: string;
  isActive: boolean;
  isGap: boolean;
  totalTokens: number;
  costUSD: number;
  models: string[];
  burnRate?: { tokensPerMinute: number; costPerHour: number };
  projection?: { totalTokens: number; totalCost: number; remainingMinutes: number };
}

export interface BlocksActiveReport {
  blocks: ActiveBlock[];
}
