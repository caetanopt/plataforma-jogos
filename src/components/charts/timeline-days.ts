/**
 * Dias do gráfico de participações. Fica fora do componente do gráfico para a
 * tabela acessível (renderizada no servidor) usar os mesmos dias sem importar
 * o recharts.
 */

export interface TimelinePoint {
  /** Dia em UTC, `AAAA-MM-DD` (ver getCampaignStats). */
  date: string;
  count: number;
}

/** Altura do gráfico, eixo incluído. O esqueleto e o estado vazio usam a mesma. */
export const TIMELINE_CHART_HEIGHT = 260;

const DAY_MS = 86_400_000;
/** Acima disto o eixo fica com barras de 1 px: mostram-se só os dias com dados. */
const MAX_FILLED_DAYS = 400;

function parseDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * Os dias sem participações não vêm da base de dados. Sem eles o eixo do
 * tempo encolhia: 21/09 e 28/09 ficavam lado a lado, como dias seguidos.
 * Preenche-se o intervalo entre o primeiro e o último dia com zeros.
 */
export function fillMissingDays(data: TimelinePoint[]): TimelinePoint[] {
  if (data.length < 2) return data;
  const first = parseDay(data[0].date);
  const last = parseDay(data[data.length - 1].date);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return data;

  const days = Math.round((last - first) / DAY_MS) + 1;
  if (days <= data.length || days > MAX_FILLED_DAYS) return data;

  const counts = new Map(data.map((point) => [point.date, point.count]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(first + index * DAY_MS).toISOString().slice(0, 10);
    return { date, count: counts.get(date) ?? 0 };
  });
}

/** `21/09` — ou `21/09/26` quando o gráfico atravessa mais de um ano. */
export function formatShortDay(date: string, withYear = false): string {
  const [year, month, day] = date.split("-");
  if (!year || !month || !day) return date;
  return withYear ? `${day}/${month}/${year.slice(2)}` : `${day}/${month}`;
}

const longDayFormat = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** `seg., 21 de setembro de 2026` (o dia já está em UTC). */
export function formatLongDay(date: string): string {
  const time = parseDay(date);
  return Number.isFinite(time) ? longDayFormat.format(time) : date;
}
