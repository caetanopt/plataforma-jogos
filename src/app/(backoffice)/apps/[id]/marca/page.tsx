import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import {
  applyBrandKitAction,
  saveAsBrandKitAction,
  updateCampaignThemeAction,
} from "@/features/campaigns/steps/brand-actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { ThemeFieldset } from "@/components/backoffice/editor/theme-fieldset";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default async function BrandStepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    include: { theme: true },
  });
  if (!campaign || !campaign.theme) notFound();

  const [logoMedia, faviconMedia, backgroundMedia, brandKits] = await Promise.all([
    campaign.theme.logoMediaId
      ? prisma.mediaAsset.findUnique({ where: { id: campaign.theme.logoMediaId } })
      : null,
    campaign.theme.faviconMediaId
      ? prisma.mediaAsset.findUnique({ where: { id: campaign.theme.faviconMediaId } })
      : null,
    campaign.theme.backgroundImageMediaId
      ? prisma.mediaAsset.findUnique({ where: { id: campaign.theme.backgroundImageMediaId } })
      : null,
    prisma.campaignTheme.findMany({
      where: { organizationId: context.organizationId, isBrandKit: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const canManageBrand = can(context, "brand:manage");

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-caetano-anthracite">Marca e design</h2>
        <p className="mt-1 text-sm text-caetano-medium-gray">
          Personalize a identidade visual desta campanha. Cada campanha guarda a sua própria
          cópia — alterações aqui não afetam outras campanhas nem o brand kit de origem.
        </p>
      </div>

      {brandKits.length > 0 && (
        <form action={applyBrandKitAction} className="flex flex-wrap items-end gap-2 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="flex-1">
            <Label htmlFor="brandKitId">Aplicar brand kit</Label>
            <select
              id="brandKitId"
              name="brandKitId"
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
            >
              {brandKits.map((kit) => (
                <option key={kit.id} value={kit.id}>
                  {kit.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            Aplicar
          </Button>
        </form>
      )}

      <AutoSaveForm action={updateCampaignThemeAction} className="space-y-4">
        <input type="hidden" name="campaignId" value={campaign.id} />
        <input type="hidden" name="name" value={campaign.theme.name} />
        <ThemeFieldset
          theme={campaign.theme}
          media={{ logo: logoMedia, favicon: faviconMedia, background: backgroundMedia }}
        />
        <SaveStatus />
      </AutoSaveForm>

      {canManageBrand && (
        <form action={saveAsBrandKitAction} className="flex flex-wrap items-end gap-2 rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
          <input type="hidden" name="campaignId" value={campaign.id} />
          <div className="flex-1">
            <Label htmlFor="kitName">Guardar como brand kit reutilizável</Label>
            <Input id="kitName" name="kitName" placeholder="Nome do brand kit" required />
          </div>
          <Button type="submit" variant="outline">
            Guardar brand kit
          </Button>
        </form>
      )}
    </div>
  );
}
