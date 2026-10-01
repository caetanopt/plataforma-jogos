"use client";

import { useId } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import {
  TIMELINE_CHART_HEIGHT,
  formatLongDay,
  formatShortDay,
  type TimelinePoint,
} from "@/components/charts/timeline-days";

/*
  Cores da paleta Caetano, lidas dos tokens de globals.css: o gráfico muda com
  a marca sem cores escritas aqui. Grelha e eixos recessivos (cinza médio,
  linhas finas e contínuas), texto em antracite -80, a barra do azul profundo
  ao azul cyan — a luz dos fundos digitais do Brand Book.
*/
const GRID = "var(--color-caetano-medium-gray-40)";
const BASELINE = "var(--color-caetano-medium-gray-60)";
const TICK = { fontSize: 12, fill: "var(--color-caetano-anthracite-80)" };

/**
 * Carregado por participation-timeline-chart-lazy.tsx, que trata o caso sem
 * dados e preenche os dias em falta.
 */
export function ParticipationTimelineChart({ data }: { data: TimelinePoint[] }) {
  // Um id por gráfico para o gradiente: dois gráficos na mesma página não se
  // pisam. O useId traz caracteres que não servem num url(#...).
  const gradientId = `timeline-bar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const multiYear = data.length > 1 && data[0].date.slice(0, 4) !== data[data.length - 1].date.slice(0, 4);

  return (
    <div className="tabular-nums [&_.recharts-surface]:outline-none [&_.recharts-surface:focus-visible]:rounded-lg [&_.recharts-surface:focus-visible]:ring-2 [&_.recharts-surface:focus-visible]:ring-caetano-cyan">
      <ResponsiveContainer width="100%" height={TIMELINE_CHART_HEIGHT}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          barCategoryGap="20%"
          // Nome da zona focável do gráfico (accessibilityLayer: setas
          // percorrem os dias e mostram o tooltip).
          aria-label="Participações por dia. Use as setas para percorrer os dias."
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-caetano-cyan)" />
              <stop offset="100%" stopColor="var(--color-caetano-deep-blue)" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => formatShortDay(value, multiYear)}
            tick={TICK}
            tickLine={false}
            axisLine={{ stroke: BASELINE }}
            tickMargin={10}
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tick={TICK}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={44}
            tickFormatter={(value: number) => value.toLocaleString("pt-PT")}
          />
          <Tooltip
            content={TimelineTooltip}
            cursor={{ fill: "var(--color-caetano-medium-gray-20)" }}
            animationDuration={200}
            animationEasing="ease-out"
          />
          <Bar
            dataKey="count"
            name="Participações"
            fill={`url(#${gradientId})`}
            activeBar={{ fill: "var(--color-caetano-cyan)" }}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            animationDuration={700}
            animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** O valor primeiro e em destaque; o dia por baixo, mais leve. */
function TimelineTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].value ?? 0);
  return (
    <div className="rounded-xl border border-caetano-medium-gray-40 bg-white px-3.5 py-2.5 shadow-md">
      <p className="flex items-baseline gap-1.5 text-caetano-deep-blue">
        <span className="text-lg font-bold tabular-nums">{value.toLocaleString("pt-PT")}</span>
        <span className="text-xs font-medium text-caetano-anthracite-80">
          {value === 1 ? "participação" : "participações"}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-caetano-anthracite-80">{formatLongDay(String(label))}</p>
    </div>
  );
}
