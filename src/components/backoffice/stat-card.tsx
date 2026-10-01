import type { ReactNode } from "react";

/**
 * Um número das estatísticas. O valor em Montserrat Light, grande, no azul
 * profundo — a hierarquia do Brand Book (títulos fortes, texto leve) aplicada
 * aos números — e a faixa do azul profundo ao azul cyan no topo.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  /** Ícone decorativo (lucide). */
  icon?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-caetano-medium-gray-40 bg-white p-5 shadow-xs">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-caetano-deep-blue via-caetano-cyan to-caetano-sky"
      />
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-caetano-anthracite-80">{label}</p>
        {icon && (
          <span aria-hidden="true" className="text-caetano-deep-blue-60">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-light tabular-nums tracking-tight text-caetano-deep-blue">{value}</p>
      {hint && <p className="mt-1 text-xs text-caetano-anthracite-80">{hint}</p>}
    </div>
  );
}
