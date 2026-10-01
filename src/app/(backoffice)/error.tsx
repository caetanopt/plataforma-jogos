"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { CalmState } from "@/components/backoffice/admin/calm-state";

/**
 * Fronteira de erro do backoffice.
 *
 * Sem isto, qualquer exceção em tempo de execução numa página derrubava a
 * árvore inteira e o utilizador ficava com um ecrã em branco. Aqui mantém-se
 * a navegação e oferece-se uma forma de recuperar.
 *
 * A mensagem do erro não é mostrada: pode conter detalhes de infraestrutura ou
 * dados de participantes. Fica o `digest`, que o Next associa ao registo no
 * servidor.
 */
export default function BackofficeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sem dados pessoais: só a referência que permite encontrar o erro nos logs.
    console.error("Erro no backoffice", { digest: error.digest });
  }, [error.digest]);

  return (
    <CalmState
      icon={<TriangleAlert size={28} strokeWidth={1.75} />}
      title="Algo correu mal"
      description="Não foi possível carregar esta página. A operação não foi concluída."
    >
      <div className="w-full max-w-md text-left">
        <Alert variant="error">
          Tente novamente. Se o problema persistir, indique a referência abaixo a quem der apoio.
        </Alert>
      </div>

      {error.digest && (
        <p className="text-xs text-caetano-anthracite-80">
          Referência:{" "}
          <code className="rounded-md bg-caetano-medium-gray-20 px-1.5 py-0.5 font-mono text-caetano-anthracite ring-1 ring-caetano-medium-gray-40 select-all">
            {error.digest}
          </code>
        </p>
      )}

      <Button onClick={reset} size="lg" className="group/retry">
        <RotateCw
          size={18}
          aria-hidden="true"
          className="transition-transform duration-300 ease-(--ease-out-expo) motion-safe:group-hover/retry:rotate-90"
        />
        Tentar novamente
      </Button>
    </CalmState>
  );
}
