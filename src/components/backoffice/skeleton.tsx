/**
 * Blocos de esqueleto para os `loading.tsx` do backoffice.
 *
 * Servem de fallback ao nível da rota: o Next mostra-os imediatamente
 * enquanto o Server Component obtém os dados, o que torna a navegação
 * instantânea em vez de deixar o ecrã anterior congelado.
 */

function Bar({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded bg-caetano-medium-gray-40 motion-safe:animate-pulse ${className}`}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
      <Bar className="h-3 w-24" />
      <Bar className="mt-3 h-7 w-16" />
    </div>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-4">
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Bar className="h-9 w-9 shrink-0 rounded-lg" />
            <Bar className="h-3 flex-1" />
            <Bar className="h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Casca partilhada: título, um bloco de filtros e o conteúdo específico.
 * O `role="status"` com texto só para leitores de ecrã anuncia o
 * carregamento sem o repetir visualmente.
 */
export function SkeletonPage({
  titleWidth = "w-48",
  children,
}: {
  titleWidth?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-6 md:p-8" role="status" aria-live="polite">
      <span className="sr-only">A carregar…</span>
      <Bar className={`h-7 ${titleWidth}`} />
      <Bar className="mt-2 h-3 w-72 max-w-full" />
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}
