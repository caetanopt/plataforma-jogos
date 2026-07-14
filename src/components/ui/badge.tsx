import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "success" | "warning" | "info" | "danger";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-neutral-100 text-caetano-anthracite",
  success: "bg-caetano-eco-green/15 text-caetano-eco-green",
  warning: "bg-caetano-dynamic-orange/15 text-caetano-dynamic-orange",
  info: "bg-caetano-cyan/15 text-caetano-deep-blue",
  danger: "bg-red-100 text-red-700",
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
