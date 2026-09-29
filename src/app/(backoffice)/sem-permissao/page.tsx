import Link from "next/link";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Sem permissão" };

/**
 * Destino das páginas do backoffice que o papel do utilizador não permite
 * (ver `requirePagePermission`). O layout do backoffice continua a exigir
 * sessão; aqui só se explica o que aconteceu.
 */
export default function NoPermissionPage() {
  return (
    <div className="p-4 sm:p-6 md:p-8">
      <div className="mx-auto max-w-lg rounded-xl border border-caetano-medium-gray-40 bg-white">
        <EmptyState
          title="Não tem permissão para abrir esta página"
          description="O seu papel nesta organização não inclui esta área. Se precisar de acesso, peça a um administrador da organização."
          action={
            <Link
              href="/folders"
              className="inline-flex h-10 items-center rounded-lg bg-caetano-deep-blue px-4 text-sm font-medium text-white hover:bg-caetano-deep-blue-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan focus-visible:ring-offset-2"
            >
              Voltar ao início
            </Link>
          }
        />
      </div>
    </div>
  );
}
