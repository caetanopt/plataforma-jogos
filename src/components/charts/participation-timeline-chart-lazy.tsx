"use client";

import dynamic from "next/dynamic";
import { ChartColumn } from "lucide-react";
import {
  TIMELINE_CHART_HEIGHT,
  fillMissingDays,
  formatLongDay,
  type TimelinePoint,
} from "@/components/charts/timeline-days";

/**
 * O recharts (~100 KB comprimidos) só é pedido quando o gráfico aparece: no
 * render do servidor o gráfico é um div vazio, e antes o bundle inteiro de
 * /analytics esperava por ele.
 */
const LazyParticipationTimelineChart = dynamic(
  () => import("@/components/charts/participation-timeline-chart").then((module) => module.ParticipationTimelineChart),
  {
    ssr: false,
    // Com a altura do gráfico: nada salta quando ele chega.
    loading: () => (
      <div className="skeleton rounded-xl" style={{ height: TIMELINE_CHART_HEIGHT }} aria-hidden="true" />
    ),
  },
);

export function ParticipationTimelineChart({ data }: { data: TimelinePoint[] }) {
  // Sem dados, a mensagem sai já do servidor, na altura do gráfico: antes
  // aparecia um esqueleto de 240 px que depois encolhia para uma linha.
  if (data.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-3 rounded-xl bg-caetano-medium-gray-20 px-6 text-center"
        style={{ height: TIMELINE_CHART_HEIGHT }}
      >
        <span
          aria-hidden="true"
          className="flex h-12 w-12 items-center justify-center rounded-2xl bg-caetano-cyan-20 text-caetano-deep-blue"
        >
          <ChartColumn size={22} />
        </span>
        <p className="max-w-xs text-sm text-caetano-anthracite-80">Sem dados suficientes para o período selecionado.</p>
      </div>
    );
  }

  return (
    <>
      <LazyParticipationTimelineChart data={fillMissingDays(data)} />
      {/*
        A mesma informação em tabela, para leitores de ecrã: o gráfico só se
        lê com o rato ou com as setas (tooltip). Sai já do servidor, e só com
        os dias que têm participações — os zeros do eixo seriam ruído aqui.
        O sr-only fica num div: uma tabela ignora a largura de 1 px e
        alargava a página no telemóvel.
      */}
      <div className="sr-only">
        <table>
          <caption>Participações por dia</caption>
          <thead>
            <tr>
              <th scope="col">Dia</th>
              <th scope="col">Participações</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.date}>
                <th scope="row">{formatLongDay(point.date)}</th>
                <td>{point.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
