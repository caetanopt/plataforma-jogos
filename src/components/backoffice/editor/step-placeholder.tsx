import { Construction } from "lucide-react";

export function StepPlaceholder({ title }: { title: string }) {
  return (
    <div className="max-w-3xl rounded-2xl border border-dashed border-caetano-medium-gray-60 bg-white px-6 py-12 text-center shadow-xs">
      <span
        aria-hidden="true"
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-caetano-cyan-20 text-caetano-deep-blue"
      >
        <Construction size={24} />
      </span>
      <h2 className="text-lg font-bold text-caetano-deep-blue sm:text-xl">{title}</h2>
      <p className="mt-2 text-sm text-caetano-anthracite-80">Esta etapa está em construção.</p>
    </div>
  );
}
