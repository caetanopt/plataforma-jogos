import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertVariant = "error" | "success" | "info";

const variantClasses: Record<AlertVariant, string> = {
  error: "bg-danger-surface text-danger-strong border-danger",
  success: "bg-caetano-eco-green-20 text-caetano-eco-green border-caetano-eco-green-40",
  info: "bg-caetano-cyan-20 text-caetano-deep-blue border-caetano-cyan-40",
};

export function Alert({ variant = "info", children }: { variant?: AlertVariant; children: ReactNode }) {
  return (
    <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm", variantClasses[variant])}>
      {children}
    </div>
  );
}
