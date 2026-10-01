import { ChartColumn, Eye, PenLine, ShieldCheck } from "lucide-react";
import type { MembershipRole } from "@/generated/prisma/client";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

/*
  Um tom por papel, do mais forte (administrador, no azul profundo) ao mais
  discreto (visualizador). O texto fica sempre no azul profundo ou no
  antracite: o verde eco sobre o seu tom claro não chega aos 4,5:1. O ícone
  repete o papel para quem não distingue as cores.
*/
const ROLE_STYLES: Record<MembershipRole, { className: string; Icon: typeof Eye }> = {
  ORG_ADMIN: { className: "bg-caetano-deep-blue text-white", Icon: ShieldCheck },
  EDITOR: { className: "bg-caetano-cyan-20 text-caetano-deep-blue ring-1 ring-caetano-cyan-40", Icon: PenLine },
  ANALYST: {
    className: "bg-caetano-eco-green-20 text-caetano-anthracite ring-1 ring-caetano-eco-green-40",
    Icon: ChartColumn,
  },
  VIEWER: {
    className: "bg-caetano-medium-gray-20 text-caetano-anthracite ring-1 ring-caetano-medium-gray-40",
    Icon: Eye,
  },
};

export function RoleBadge({ role }: { role: MembershipRole }) {
  const { className, Icon } = ROLE_STYLES[role];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
        className,
      )}
    >
      <Icon size={13} aria-hidden="true" className="shrink-0" />
      {MEMBERSHIP_ROLE_LABELS[role]}
    </span>
  );
}
