"use client";

import dynamic from "next/dynamic";

/**
 * O recharts (~100 KB comprimidos) só é pedido quando o gráfico aparece: no
 * render do servidor o gráfico é um div vazio, e antes o bundle inteiro de
 * /analytics esperava por ele.
 */
export const ParticipationTimelineChart = dynamic(
  () => import("@/components/charts/participation-timeline-chart").then((module) => module.ParticipationTimelineChart),
  {
    ssr: false,
    loading: () => <div className="h-60 animate-pulse rounded-lg bg-caetano-medium-gray-20" aria-hidden="true" />,
  },
);
