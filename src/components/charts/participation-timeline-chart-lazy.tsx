"use client";

import dynamic from "next/dynamic";

/**
 * O recharts (~100 KB comprimidos) só é pedido quando o gráfico aparece: no
 * render do servidor o gráfico é um div vazio, e antes o bundle inteiro de
 * /analytics esperava por ele.
 */
const LazyParticipationTimelineChart = dynamic(
  () => import("@/components/charts/participation-timeline-chart").then((module) => module.ParticipationTimelineChart),
  {
    ssr: false,
    loading: () => <div className="h-60 animate-pulse rounded-lg bg-caetano-medium-gray-20" aria-hidden="true" />,
  },
);

export function ParticipationTimelineChart({ data }: { data: Array<{ date: string; count: number }> }) {
  // Sem dados, a mensagem sai já do servidor: antes aparecia um esqueleto de
  // 240 px que depois encolhia para uma linha.
  if (data.length === 0) {
    return <p className="text-sm text-caetano-anthracite-80">Sem dados suficientes para o período selecionado.</p>;
  }
  return <LazyParticipationTimelineChart data={data} />;
}
