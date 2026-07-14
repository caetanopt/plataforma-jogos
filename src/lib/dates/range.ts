export type PeriodPreset = "7d" | "30d" | "90d" | "custom";

export interface DateRange {
  preset: PeriodPreset;
  from: Date;
  to: Date;
}

const PRESET_DAYS: Record<Exclude<PeriodPreset, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/**
 * Resolve um intervalo de datas a partir dos parâmetros de filtro do dashboard
 * e das estatísticas (secção 4 e 20 do CLAUDE.md: 7/30/90 dias ou intervalo
 * personalizado).
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

  const preset: Exclude<PeriodPreset, "custom"> =
    params.period === "7d" || params.period === "90d" ? params.period : "30d";

  const from = new Date(endOfToday);
  from.setDate(from.getDate() - PRESET_DAYS[preset] + 1);
  from.setHours(0, 0, 0, 0);

  return { preset, from, to: endOfToday };
}
