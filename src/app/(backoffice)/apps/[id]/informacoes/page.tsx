import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateProjectInfoAction } from "@/features/campaigns/steps/project-info-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { SaveStatus } from "@/components/backoffice/editor/save-status";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CAMPAIGN_TYPE_LABELS } from "@/lib/labels";

const LOCALES = [
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en-GB", label: "Inglês (Reino Unido)" },
  { value: "es-ES", label: "Espanhol" },
];

const TIMEZONES = ["Europe/Lisbon", "Atlantic/Azores", "UTC"];

export default async function ProjectInfoStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { name: "asc" },
    include: { folders: { where: { archivedAt: null }, orderBy: { name: "asc" } } },
  });

  const hasParticipations = campaign._count.participations > 0;

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-semibold text-caetano-anthracite">Informações do projeto</h2>
      <p className="mt-1 text-sm text-caetano-medium-gray">
        Dados internos de organização da campanha. O tipo de jogo (
        {CAMPAIGN_TYPE_LABELS[campaign.type]}) é definido na criação e não pode ser alterado
        {hasParticipations ? " — esta campanha já tem participações reais." : "."}
      </p>

      <AutoSaveForm action={updateProjectInfoAction} className="mt-6 space-y-4">
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div>
          <Label htmlFor="internalName">Nome interno</Label>
          <Input id="internalName" name="internalName" defaultValue={campaign.internalName} required />
        </div>

        <div>
          <Label htmlFor="publicTitle">Título público</Label>
          <Input id="publicTitle" name="publicTitle" defaultValue={campaign.publicTitle ?? ""} />
        </div>

        <div>
          <Label htmlFor="internalReference">Referência interna</Label>
          <Input
            id="internalReference"
            name="internalReference"
            defaultValue={campaign.internalReference ?? ""}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="workspaceId">Espaço de trabalho</Label>
            <select
              id="workspaceId"
              name="workspaceId"
              defaultValue={campaign.workspaceId}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="folderId">Pasta</Label>
            <select
              id="folderId"
              name="folderId"
              defaultValue={campaign.folderId ?? ""}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
            >
              <option value="">Sem pasta</option>
              {workspaces
                .find((w) => w.id === campaign.workspaceId)
                ?.folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="tags">Etiquetas (separadas por vírgula)</Label>
          <Input id="tags" name="tags" defaultValue={campaign.tags.join(", ")} />
        </div>

        <div>
          <Label htmlFor="description">Descrição</Label>
          <textarea
            id="description"
            name="description"
            defaultValue={campaign.description ?? ""}
            rows={3}
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="locale">Idioma</Label>
            <select
              id="locale"
              name="locale"
              defaultValue={campaign.locale}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
            >
              {LOCALES.map((locale) => (
                <option key={locale.value} value={locale.value}>
                  {locale.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="timezone">Fuso horário</Label>
            <select
              id="timezone"
              name="timezone"
              defaultValue={campaign.timezone}
              className="h-10 w-full rounded-lg border border-caetano-medium-gray px-3 text-sm"
            >
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label htmlFor="slug">Slug público</Label>
          <Input id="slug" name="slug" defaultValue={campaign.slug} />
          <p className="mt-1 text-xs text-caetano-medium-gray">
            URL pública: /play/{campaign.slug}
          </p>
        </div>

        <SaveStatus />
      </AutoSaveForm>
    </div>
  );
}
