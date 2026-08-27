"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, TriangleAlert } from "lucide-react";
import { EDITOR_STEPS } from "@/components/backoffice/editor/steps";
import { cn } from "@/lib/utils";

export function EditorNav({
  campaignId,
  incompleteSteps,
}: {
  campaignId: string;
  incompleteSteps: string[];
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Etapas do editor" className="w-full shrink-0 border-caetano-medium-gray/30 bg-white md:w-64 md:border-r">
      <ol className="flex overflow-x-auto md:flex-col md:overflow-visible">
        {EDITOR_STEPS.map((step, index) => {
          const isActive = pathname === `/apps/${campaignId}/${step.slug}`;
          const isIncomplete = incompleteSteps.includes(step.slug);
          return (
            <li key={step.slug} className="shrink-0 md:shrink">
              <Link
                href={`/apps/${campaignId}/${step.slug}`}
                aria-current={isActive ? "step" : undefined}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap px-4 py-3 text-sm font-medium",
                  isActive
                    ? "bg-caetano-deep-blue text-white"
                    : "text-caetano-anthracite hover:bg-neutral-100",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs",
                    isActive
                      ? "bg-white/20 text-white"
                      : isIncomplete
                        ? "border border-caetano-dynamic-orange text-caetano-dynamic-orange"
                        : "border border-caetano-eco-green text-caetano-eco-green",
                  )}
                  aria-hidden="true"
                >
                  {isActive ? (
                    index + 1
                  ) : isIncomplete ? (
                    <TriangleAlert size={12} />
                  ) : (
                    <Check size={12} />
                  )}
                </span>
                {step.label}
                {/* A cor sozinha (laranja/verde) não chega para distinguir
                    incompleta de completa — WCAG 1.4.1 — e o ícone acima é
                    decorativo (aria-hidden). Este texto dá a mesma
                    informação a leitores de ecrã. */}
                {!isActive && <span className="sr-only">{isIncomplete ? " (incompleta)" : " (completa)"}</span>}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
