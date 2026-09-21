/**
 * Fallback da aplicação pública.
 *
 * Sem isto, o participante via um ecrã branco enquanto as queries da campanha
 * corriam — e é aqui que a primeira impressão da campanha se joga.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-lg p-4" role="status" aria-live="polite">
      <span className="sr-only">A carregar a campanha…</span>
      <div className="rounded-xl border border-caetano-medium-gray-40 bg-white p-6">
        <span
          aria-hidden="true"
          className="mx-auto block h-6 w-48 rounded bg-caetano-medium-gray-40 motion-safe:animate-pulse"
        />
        <span
          aria-hidden="true"
          className="mx-auto mt-3 block h-3 w-64 max-w-full rounded bg-caetano-medium-gray-40 motion-safe:animate-pulse"
        />
        <span
          aria-hidden="true"
          className="mx-auto mt-6 block h-40 w-full rounded-lg bg-caetano-medium-gray-40 motion-safe:animate-pulse"
        />
        <span
          aria-hidden="true"
          className="mx-auto mt-6 block h-12 w-40 rounded-full bg-caetano-medium-gray-40 motion-safe:animate-pulse"
        />
      </div>
    </div>
  );
}
