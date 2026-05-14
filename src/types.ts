export interface ModelBreakdown {
  modelName: string;
  cost: number;
}

export interface DailyData {
  totalCost: number;
  totalTokens: number;
  modelBreakdowns: ModelBreakdown[];
}

export interface MonthlyData {
  totalCost: number;
  totalTokens: number;
}

export interface BlockData {
  costUSD: number;
  remainingMinutes: number | null;
}
