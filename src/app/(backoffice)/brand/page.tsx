import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { prisma } from "@/server/db/client";
import { createBrandKitAction, deleteBrandKitAction, updateBrandKitAction } from "@/features/brand/actions";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ThemeFieldset } from "@/components/backoffice/editor/theme-fieldset";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";

export default async function BrandKitsPage() {
  const context = await requireOrgContext();
  assertCan(context, "brand:manage");

  const kits = await prisma.campaignTheme.findMany({
    where: { organizationId: context.organizationId, isBrandKit: true },
    orderBy: { name: "asc" },
  });

  const mediaIds = kits.flatMap((kit) =>
    [kit.logoMediaId, kit.faviconMediaId, kit.backgroundImageMediaId].filter(
      (value): value is string => Boolean(value),
    ),
  );
  const mediaAssets = mediaIds.length
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds } } })
    : [];
  const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-caetano-anthracite">Identidade visual</h1>
      <p className="mt-1 text-caetano-medium-gray">
        Brand kits reutilizáveis. Cada campanha recebe sempre uma cópia ao aplicar um kit —
        alterações aqui não afetam campanhas já criadas.
      </p>

      <div className="mt-6 space-y-6">
        {kits.map((kit) => (
          <details key={kit.id} className="rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
            <summary className="cursor-pointer font-medium text-caetano-anthracite">{kit.name}</summary>
            <AutoSaveForm action={updateBrandKitAction} className="mt-4 max-w-xl space-y-4">
              <input type="hidden" name="kitId" value={kit.id} />
              <div>
                <Label htmlFor={`name-${kit.id}`}>Nome</Label>
                <Input id={`name-${kit.id}`} name="name" defaultValue={kit.name} required />
              </div>
              <ThemeFieldset
                theme={kit}
                media={{
                  logo: kit.logoMediaId ? (mediaById.get(kit.logoMediaId) ?? null) : null,
                  favicon: kit.faviconMediaId ? (mediaById.get(kit.faviconMediaId) ?? null) : null,
                  background: kit.backgroundImageMediaId
                    ? (mediaById.get(kit.backgroundImageMediaId) ?? null)
                    : null,
                }}
              />
            </AutoSaveForm>
            <form action={deleteBrandKitAction} className="mt-4">
              <input type="hidden" name="kitId" value={kit.id} />
              <ConfirmSubmitButton confirmMessage={`Eliminar o brand kit "${kit.name}"?`} size="sm">
                Eliminar brand kit
              </ConfirmSubmitButton>
            </form>
          </details>
        ))}
      </div>

      <div className="mt-8 max-w-md rounded-xl border border-caetano-medium-gray/30 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-caetano-anthracite">Novo brand kit</h2>
        <form action={createBrandKitAction} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" name="name" required />
          </div>
          <Button type="submit">Criar</Button>
        </form>
      </div>
    </div>
  );
}
