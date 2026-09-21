import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
      <p className="text-sm text-caetano-medium-gray">{label}</p>
      <p className="mt-1 text-2xl font-bold text-caetano-anthracite">{value}</p>
      {hint && <p className="mt-1 text-xs text-caetano-medium-gray">{hint}</p>}
    </div>
  );
}
