import type { ReactNode } from "react";

/**
 * Um número dentro de um cartão (as secções de cada jogo). O `StatCard` já é
 * um cartão — com borda, sombra e a faixa de marca — e um cartão dentro de
 * outro pesa. Aqui o número assenta num fundo do cinza médio mais claro, com
 * a mesma hierarquia: rótulo pequeno, valor em Montserrat Light no azul
 * profundo.
 *
 * O antracite -80 sobre o cinza médio -20 dá 5,5:1 (WCAG 2.2 AA).
 */
export function MetricTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl bg-caetano-medium-gray-20 p-4">
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-caetano-anthracite-80">{label}</p>
      <p className="mt-1.5 text-2xl font-light tracking-tight text-caetano-deep-blue">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-caetano-anthracite-80">{hint}</p>}
    </div>
  );
}
