import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CalmState } from "@/components/backoffice/admin/calm-state";

export const metadata = { title: "Sem permissão" };

/**
 * Destino das páginas do backoffice que o papel do utilizador não permite
 * (ver `requirePagePermission`). O layout do backoffice continua a exigir
 * sessão; aqui só se explica o que aconteceu.
 */
export default function NoPermissionPage() {
  return (
    <CalmState
      icon={<Lock size={28} strokeWidth={1.75} />}
      title="Não tem permissão para abrir esta página"
      description="O seu papel nesta organização não inclui esta área. Se precisar de acesso, peça a um administrador da organização."
    >
      <Link href="/folders" className={buttonVariants({ size: "lg", className: "group/back" })}>
        <ArrowLeft
          size={18}
          aria-hidden="true"
          className="transition-transform duration-200 ease-(--ease-out-expo) motion-safe:group-hover/back:-translate-x-0.5"
        />
        Voltar ao início
      </Link>
    </CalmState>
  );
}
