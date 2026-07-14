export type PeriodPreset = "today" | "7d" | "30d" | "90d" | "all" | "custom";

export interface DateRange {
  preset: PeriodPreset;
  from: Date;
  to: Date;
}

const PRESET_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

const EPOCH = new Date(0);

/**
 * Resolve um intervalo de datas a partir dos parâmetros de filtro do dashboard
 * e das estatísticas (secção 4 e 20 do CLAUDE.md: hoje, 7/30/90 dias, todo o
 * período ou intervalo personalizado).
 */
export function resolveDateRange(params: {
  period?: string;
  from?: string;
  to?: string;
}): DateRange {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  if (params.period === "custom" && params.from && params.to) {
    const from = new Date(params.from);
    const to = new Date(params.to);
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { preset: "custom", from, to };
    }
  }

  if (params.period === "today") {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return { preset: "today", from: startOfToday, to: endOfToday };
  }

  if (params.period === "all") {
    return { preset: "all", from: EPOCH, to: endOfToday };
  }

  const preset: "7d" | "30d" | "90d" = params.period === "7d" || params.period === "90d" ? params.period : "30d";

  const from = new Date(endOfToday);
  from.setDate(from.getDate() - PRESET_DAYS[preset] + 1);
  from.setHours(0, 0, 0, 0);

  return { preset, from, to: endOfToday };
}
