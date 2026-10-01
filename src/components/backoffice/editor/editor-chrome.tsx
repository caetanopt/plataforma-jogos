"use client";

import { usePathname } from "next/navigation";
import { Eye, Send } from "lucide-react";
import { EDITOR_STEPS } from "@/components/backoffice/editor/steps";
import { ProgressLink } from "@/components/backoffice/navigation-progress";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
  Botão de contorno sobre a superfície de marca: texto branco e uma borda no
  azul profundo -40 (que se vê sobre o azul profundo e sobre a luz do cyan).
  O foco é o anel branco do `inverse`.
*/
const ON_BRAND_OUTLINE = cn(
  "border border-caetano-deep-blue-40 bg-caetano-deep-blue text-white shadow-sm",
  "hover:border-white hover:bg-caetano-deep-blue-80 active:bg-caetano-deep-blue",
  "focus-visible:ring-white focus-visible:ring-offset-caetano-deep-blue",
  "motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0",
);

/**
 * Ações do cabeçalho do editor: pré-visualizar e ir para a publicação. São
 * links para as páginas que já existem — publicar continua a ser o botão da
 * etapa Publicação, que verifica se a campanha está pronta.
 */
export function EditorHeaderActions({ campaignId, canPublish }: { campaignId: string; canPublish: boolean }) {
  const pathname = usePathname();
  const previewHref = `/apps/${campaignId}/preview`;
  const publishHref = `/apps/${campaignId}/publicar`;
  const onPreview = pathname === previewHref;
  const onPublish = pathname === publishHref;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ProgressLink
        href={previewHref}
        prefetch={false}
        aria-current={onPreview ? "page" : undefined}
        // Na pré-visualização, o botão fica aceso no azul cyan: é onde se está.
        className={buttonVariants({
          variant: onPreview ? "secondary" : "ghost",
          className: onPreview
            ? "focus-visible:ring-white focus-visible:ring-offset-caetano-deep-blue"
            : ON_BRAND_OUTLINE,
        })}
      >
        <Eye size={16} aria-hidden="true" />
        Pré-visualizar
      </ProgressLink>
      {/* Na própria etapa o botão que publica é o da página. */}
      {canPublish && !onPublish && (
        <ProgressLink href={publishHref} prefetch={false} className={buttonVariants({ variant: "inverse" })}>
          <Send size={16} aria-hidden="true" />
          Publicar
        </ProgressLink>
      )}
    </div>
  );
}

/** "Etapa 3 de 10" por cima do título de cada etapa (o editorial do Brand Book). */
export function EditorStepLabel({ campaignId }: { campaignId: string }) {
  const pathname = usePathname();
  const index = EDITOR_STEPS.findIndex((step) => pathname === `/apps/${campaignId}/${step.slug}`);
  if (index < 0) return null;

  return (
    <p className="mb-1.5 text-xs font-medium uppercase tracking-[0.14em] text-caetano-deep-blue-80">
      Etapa {index + 1} de {EDITOR_STEPS.length}
    </p>
  );
}
