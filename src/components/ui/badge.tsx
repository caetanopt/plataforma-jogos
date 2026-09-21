import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "success" | "warning" | "info" | "danger";

/*
  O texto usa antracite nos fundos verde e laranja. O verde eco sobre o seu
  tom claro dá 2,16:1 e o laranja dá 1,68:1 — muito abaixo dos 4,5:1 da
  WCAG 2.2 AA. A paleta não tem tons mais escuros destas cores, por isso a
  distinção passa a vir do fundo e da borda, não do texto.
*/
const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-caetano-medium-gray-20 text-caetano-anthracite",
  success: "bg-caetano-eco-green-20 text-caetano-anthracite ring-1 ring-caetano-eco-green-40",
  warning: "bg-caetano-dynamic-orange-20 text-caetano-anthracite ring-1 ring-caetano-dynamic-orange-40",
  info: "bg-caetano-cyan-20 text-caetano-deep-blue ring-1 ring-caetano-cyan-40",
  danger: "bg-danger-surface text-danger-strong ring-1 ring-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}
