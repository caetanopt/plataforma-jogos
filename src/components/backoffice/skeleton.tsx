/**
 * Blocos de esqueleto.
 *
 * ATENÇÃO — não voltar a criar `loading.tsx` dentro de `src/app/(backoffice)`.
 *
 * Um `loading.tsx` em qualquer segmento ascendente de uma rota do backoffice
 * faz com que as server actions que atualizam a página apenas com
 * `revalidatePath` (sem `redirect`) deixem de refletir na interface: a ação
 * corre, os dados são gravados, mas o ecrã fica na versão anterior. Medido
 * nesta versão do Next (16.2.10) com a suite e2e e reproduzido à mão.
 *
 * Isso atinge todo o editor de campanhas — marca, memória, roda, quiz e
 * prémios revalidam sem redirecionar — e falha em silêncio, que é o pior
 * modo de falhar: o utilizador julga que a alteração não foi guardada e
 * repete-a.
 *
 * A documentação instalada (03-api-reference/03-file-conventions/layout.md,
 * "Interaction with loading.js") já avisa que um `loading.tsx` não cobre o
 * acesso a dados em runtime feito no `layout.js` — e o layout do backoffice
 * faz precisamente isso, em `requireOrgContext()`, que é a fronteira de
 * autorização e não pode ser adiada por streaming.
 *
 * O feedback de navegação é dado pela barra de progresso no topo
 * (`navigation-progress.tsx`), que não mexe na semântica de renderização.
 *
 * Estes blocos continuam disponíveis para esqueletos dentro de uma página,
 * com `<Suspense>` explícito à volta de uma secção lenta — esse caso não tem
 * o problema acima.
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
    <div className="p-4 sm:p-6 md:p-8" role="status" aria-live="polite">
      <span className="sr-only">A carregar…</span>
      <Bar className={`h-7 ${titleWidth}`} />
      <Bar className="mt-2 h-3 w-72 max-w-full" />
      <div className="mt-6 space-y-6">{children}</div>
    </div>
  );
}
