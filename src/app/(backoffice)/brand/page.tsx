import { ChevronDown, Palette } from "lucide-react";
import { requirePagePermission } from "@/server/auth/page-guard";
import { prisma } from "@/server/db/client";
import {
  createBrandKitAction,
  deleteBrandKitAction,
  updateBrandKitAction,
  updateOrganizationLogoAction,
} from "@/features/brand/actions";
import { BRAND_THEME_LIMITS } from "@/lib/validation/brand";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { ActionForm } from "@/components/backoffice/editor/action-form";
import { ThemeFieldset } from "@/components/backoffice/editor/theme-fieldset";
import { MediaUploadField } from "@/components/backoffice/editor/media-upload-field";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Identidade visual" };

export default async function BrandKitsPage() {
  const context = await requirePagePermission("brand:manage");

  const organization = await prisma.organization.findUnique({
    where: { id: context.organizationId },
    select: { name: true, logoMediaId: true },
  });
  const organizationLogo = organization?.logoMediaId
    ? await prisma.mediaAsset.findFirst({
        where: { id: organization.logoMediaId, organizationId: context.organizationId },
      })
    : null;

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
    ? await prisma.mediaAsset.findMany({ where: { id: { in: mediaIds }, organizationId: context.organizationId } })
    : [];
  const mediaById = new Map(mediaAssets.map((asset) => [asset.id, asset]));

  return (
    <div className="p-4 sm:p-6 md:p-8">
      <PageHeader
        title="Identidade visual"
        description="Brand kits reutilizáveis. Cada campanha recebe sempre uma cópia ao aplicar um kit — alterações aqui não afetam campanhas já criadas."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-caetano-medium-gray-40 bg-white p-5 shadow-xs">
            <h2 className="text-base font-bold text-caetano-deep-blue">Logótipo da organização</h2>
            <p className="mt-1 text-sm text-caetano-anthracite-80">
              Ficheiro oficial usado no backoffice. O wordmark é um desenho autoral sem fonte
              associada, por isso só pode ser apresentado a partir do ficheiro oficial da marca —
              sem ele, mostramos apenas o nome do produto.
            </p>
            {/* Grava quando o upload termina ou ao remover; o estado da gravação
                aparece por baixo do campo. */}
            <AutoSaveForm action={updateOrganizationLogoAction} className="mt-4 space-y-4">
              <MediaUploadField
                name="logoMediaId"
                label="Logótipo"
                defaultMediaId={organization?.logoMediaId ?? null}
                defaultUrl={organizationLogo?.url}
                defaultKind={organizationLogo?.kind}
                accept="image/png,image/svg+xml,image/webp"
                helpText="PNG ou SVG com fundo transparente. Altura mínima recomendada: 28 px."
              />
            </AutoSaveForm>
          </section>

          <section className="rounded-2xl border border-caetano-medium-gray-40 bg-white p-5 shadow-xs">
            <h2 className="mb-3 text-base font-bold text-caetano-deep-blue">Novo brand kit</h2>
            <ActionForm action={createBrandKitAction} className="flex flex-wrap items-end gap-2" messageClassName="w-full">
              <div className="min-w-0 flex-1">
                <Label htmlFor="newBrandKitName">Nome</Label>
                <Input id="newBrandKitName" name="name" maxLength={BRAND_THEME_LIMITS.name} required />
              </div>
              <SubmitButton>Criar</SubmitButton>
            </ActionForm>
          </section>
        </div>

        <section aria-labelledby="brand-kits-heading" className="min-w-0">
          <h2 id="brand-kits-heading" className="mb-3 text-base font-bold text-caetano-deep-blue sm:text-lg">
            Brand kits
          </h2>
          {kits.length === 0 && (
            <div className="rounded-2xl border border-dashed border-caetano-anthracite-40 bg-white">
              <EmptyState
                icon={<Palette size={24} />}
                title="Ainda não há brand kits"
                description="Crie o primeiro ao lado ou guarde o tema de uma campanha na etapa Marca e design."
              />
            </div>
          )}
          <div className="space-y-4">
            {kits.map((kit) => {
              // Um formulário por kit na mesma página: os ids levam o id do kit.
              const idPrefix = `kit-${kit.id}-`;
              return (
                <details
                  key={kit.id}
                  className="group rounded-2xl border border-caetano-medium-gray-40 bg-white shadow-xs transition-shadow duration-300 open:shadow-md"
                >
                  <summary className="flex cursor-pointer list-none select-none items-center gap-4 rounded-2xl p-4 transition-colors hover:bg-caetano-medium-gray-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caetano-cyan sm:p-5 [&::-webkit-details-marker]:hidden">
                    {/* As cores do kit, para o reconhecer sem o abrir. */}
                    <span aria-hidden="true" className="flex shrink-0 -space-x-1.5">
                      {[kit.primaryColor, kit.secondaryColor, kit.buttonColor, kit.backgroundColor].map((color, index) => (
                        <span
                          key={index}
                          className="h-7 w-7 rounded-full border-2 border-white shadow-sm ring-1 ring-caetano-medium-gray-40"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-bold text-caetano-deep-blue">{kit.name}</span>
                    <ChevronDown
                      size={18}
                      aria-hidden="true"
                      className="shrink-0 text-caetano-anthracite-80 transition-transform duration-300 ease-(--ease-out-expo) group-open:rotate-180"
                    />
                  </summary>
                  <div className="border-t border-caetano-medium-gray-40 p-4 sm:p-5">
                    <AutoSaveForm action={updateBrandKitAction} className="max-w-xl space-y-4">
                      <input type="hidden" name="kitId" value={kit.id} />
                      <div>
                        <Label htmlFor={`${idPrefix}name`}>Nome</Label>
                        <Input
                          id={`${idPrefix}name`}
                          name="name"
                          maxLength={BRAND_THEME_LIMITS.name}
                          defaultValue={kit.name}
                          required
                        />
                      </div>
                      <ThemeFieldset
                        idPrefix={idPrefix}
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
                    <ActionForm action={deleteBrandKitAction} className="mt-6 border-t border-caetano-medium-gray-40 pt-4" messageClassName="mt-1">
                      <input type="hidden" name="kitId" value={kit.id} />
                      <ConfirmSubmitButton confirmMessage={`Eliminar o brand kit "${kit.name}"?`} size="sm">
                        Eliminar brand kit
                      </ConfirmSubmitButton>
                    </ActionForm>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
