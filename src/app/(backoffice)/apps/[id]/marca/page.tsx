import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import {
  applyBrandKitAction,
  saveAsBrandKitAction,
  updateCampaignThemeAction,
} from "@/features/campaigns/steps/brand-actions";
import { BRAND_THEME_LIMITS } from "@/lib/validation/brand";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { ThemeFieldset } from "@/components/backoffice/editor/theme-fieldset";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { selectClass, SelectShell } from "@/components/ui/select";
import { STEP_CARD_CLASS, STEP_CONTENT_CLASS, StepHeader } from "@/components/backoffice/editor/editor-ui";
import { cn } from "@/lib/utils";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function BrandStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    include: { theme: true },
  });
  if (!campaign || !campaign.theme) notFound();

  const [logoMedia, faviconMedia, backgroundMedia, brandKits] = await Promise.all([
    campaign.theme.logoMediaId
      ? prisma.mediaAsset.findFirst({
          where: { id: campaign.theme.logoMediaId, organizationId: context.organizationId },
        })
      : null,
    campaign.theme.faviconMediaId
      ? prisma.mediaAsset.findFirst({
          where: { id: campaign.theme.faviconMediaId, organizationId: context.organizationId },
        })
      : null,
    campaign.theme.backgroundImageMediaId
      ? prisma.mediaAsset.findFirst({
          where: {
            id: campaign.theme.backgroundImageMediaId,
            organizationId: context.organizationId,
          },
        })
      : null,
    prisma.campaignTheme.findMany({
      where: { organizationId: context.organizationId, isBrandKit: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManageBrand = can(context, "brand:manage");

  return (
    <div className={STEP_CONTENT_CLASS}>
      <StepHeader
        title="Marca e design"
        description="Personalize a identidade visual desta campanha. Cada campanha guarda a sua própria cópia — alterações aqui não afetam outras campanhas nem o brand kit de origem."
      />

      {brandKits.length > 0 && (
        // Fica com o kit escolhido depois de aplicar (sem reset).
        <ActionForm
          action={applyBrandKitAction}
          resetOnSuccess={false}
          className={cn("flex flex-wrap items-end gap-2", STEP_CARD_CLASS)}
          messageClassName="w-full"
        >
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="min-w-0 flex-1">
            <Label htmlFor="brandKitId">Aplicar brand kit</Label>
            <SelectShell>
              <select
                id="brandKitId"
                name="brandKitId"
                defaultValue={campaign.theme.sourceBrandKitId ?? undefined}
                className={selectClass}
              >
                {brandKits.map((kit) => (
                  <option key={kit.id} value={kit.id}>
                    {kit.name}
                  </option>
                ))}
              </select>
            </SelectShell>
          </div>
          <SubmitButton variant="outline">Aplicar</SubmitButton>
        </ActionForm>
      )}

      {/* Sem o nome do tema: não se edita aqui, e a ação mantém o gravado. */}
      <AutoSaveForm
        action={updateCampaignThemeAction}
        className={cn("space-y-4", STEP_CARD_CLASS)}
      >
        <input type="hidden" name="campaignId" value={campaign.id} />
        <ThemeFieldset
          theme={campaign.theme}
          media={{ logo: logoMedia, favicon: faviconMedia, background: backgroundMedia }}
        />
      </AutoSaveForm>

      {canManageBrand && (
        <ActionForm
          action={saveAsBrandKitAction}
          className={cn("flex flex-wrap items-end gap-2", STEP_CARD_CLASS)}
          messageClassName="w-full"
        >
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="min-w-0 flex-1">
            <Label htmlFor="kitName">Guardar como brand kit reutilizável</Label>
            <Input
              id="kitName"
              name="kitName"
              maxLength={BRAND_THEME_LIMITS.name}
              placeholder="Nome do brand kit"
              aria-describedby="kitName-help"
              required
            />
          </div>
          <SubmitButton variant="outline">Guardar brand kit</SubmitButton>
          {/* A cópia sai da base de dados: uma alteração ao tema ainda à espera
              da gravação automática não entra no kit. */}
          <p id="kitName-help" className="w-full text-xs text-caetano-anthracite-80">
            Guarda o tema tal como está gravado nesta campanha.
          </p>
        </ActionForm>
      )}
    </div>
  );
}
