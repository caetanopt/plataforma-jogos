"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

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
    <div className="p-6 md:p-8">
      <h1 className="text-2xl font-bold text-caetano-anthracite">Algo correu mal</h1>
      <p className="mt-1 text-caetano-anthracite-80">
        Não foi possível carregar esta página. Os seus dados não foram alterados.
      </p>

      <div className="mt-6 max-w-xl space-y-4">
        <Alert variant="error">
          Tente novamente. Se o problema persistir, indique a referência abaixo a quem der apoio.
        </Alert>

        {error.digest && (
          <p className="text-xs text-caetano-anthracite-80">
            Referência: <code className="font-mono">{error.digest}</code>
          </p>
        )}

        <Button onClick={reset}>Tentar novamente</Button>
      </div>
    </div>
  );
}
