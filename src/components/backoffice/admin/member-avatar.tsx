import { initials } from "@/lib/utils";

/**
 * Círculo com as iniciais de um membro. Decorativo: o nome está sempre escrito
 * ao lado, por isso fica fora da árvore de acessibilidade.
 */
export function MemberAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-caetano-cyan-20 text-xs font-bold text-caetano-deep-blue ring-1 ring-caetano-cyan-40"
    >
      {initials(name) || "?"}
    </span>
  );
}
