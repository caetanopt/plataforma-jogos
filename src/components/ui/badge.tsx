import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "success" | "warning" | "info" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-caetano-medium-gray-20 text-caetano-anthracite",
  success: "bg-caetano-eco-green-20 text-caetano-eco-green",
  warning: "bg-caetano-dynamic-orange-20 text-caetano-dynamic-orange",
  info: "bg-caetano-cyan-20 text-caetano-deep-blue",
  danger: "bg-danger-surface text-danger",
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
