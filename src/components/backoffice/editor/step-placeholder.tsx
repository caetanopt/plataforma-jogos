export function StepPlaceholder({ title }: { title: string }) {
  return (
    <div className="max-w-2xl rounded-xl border border-dashed border-caetano-medium-gray/50 p-8 text-center">
      <h2 className="text-lg font-semibold text-caetano-anthracite">{title}</h2>
      <p className="mt-2 text-sm text-caetano-medium-gray">Esta etapa está em construção.</p>
    </div>
  );
}
