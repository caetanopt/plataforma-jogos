import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertVariant = "error" | "success" | "info";

const variantClasses: Record<AlertVariant, string> = {
  error: "bg-red-50 text-red-800 border-red-200",
  success: "bg-caetano-eco-green/10 text-caetano-eco-green border-caetano-eco-green/30",
  info: "bg-caetano-cyan/10 text-caetano-deep-blue border-caetano-cyan/30",
};

export function Alert({ variant = "info", children }: { variant?: AlertVariant; children: ReactNode }) {
  return (
    <div role="alert" className={cn("rounded-lg border px-4 py-3 text-sm", variantClasses[variant])}>
      {children}
    </div>
  );
}
