import { type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertVariant = "error" | "warning" | "success" | "info";

/*
  O texto usa antracite nos fundos verde e laranja: o verde eco (#49B489) sobre
  o seu próprio tom claro fica em ~2.1:1, muito abaixo dos 4.5:1 da WCAG 2.2 AA,
  e a paleta não tem um verde mais escuro. A cor da mensagem continua a ser dada
  pelo fundo, pela borda e pelo ícone.
*/
const variantClasses: Record<AlertVariant, string> = {
  error: "bg-danger-surface text-danger-strong border-danger",
  warning: "bg-caetano-dynamic-orange-20 text-caetano-anthracite border-caetano-dynamic-orange-40",
  success: "bg-caetano-eco-green-20 text-caetano-anthracite border-caetano-eco-green-40",
  info: "bg-caetano-cyan-20 text-caetano-deep-blue border-caetano-cyan-40",
};

const variantIcons: Record<AlertVariant, typeof Info> = {
  error: XCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
};

/** Prefixo lido por leitores de ecrã — o ícone sozinho não diz a natureza. */
const variantLabels: Record<AlertVariant, string> = {
  error: "Erro:",
  warning: "Aviso:",
  success: "Sucesso:",
  info: "Informação:",
};

export function Alert({
  variant = "info",
  children,
}: {
  variant?: AlertVariant;
  children: ReactNode;
}) {
  const Icon = variantIcons[variant];
  // `alert` interrompe a leitura: justifica-se para erros e avisos, não para
  // uma confirmação ou uma nota informativa.
  const isUrgent = variant === "error" || variant === "warning";

  return (
    <div
      role={isUrgent ? "alert" : "status"}
      className={cn("flex items-start gap-2 rounded-lg border px-4 py-3 text-sm", variantClasses[variant])}
    >
      <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
      <div>
        <span className="sr-only">{variantLabels[variant]} </span>
        {children}
      </div>
    </div>
  );
}
