import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
import { getCampaignForEditor } from "@/features/campaigns/queries";
import { updateProjectInfoAction } from "@/features/campaigns/steps/project-info-actions";
import { prisma } from "@/server/db/client";
import { AutoSaveForm } from "@/components/backoffice/editor/autosave-form";
import { WorkspaceFolderFields } from "@/components/backoffice/workspace-folder-fields";
import { SyncedSelect } from "@/components/forms/synced-fields";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { CAMPAIGN_TYPE_LABELS } from "@/lib/labels";
import { PROJECT_INFO_LIMITS } from "@/lib/validation/campaign";

const LOCALES = [
  { value: "pt-PT", label: "Português (Portugal)" },
  { value: "en-GB", label: "Inglês (Reino Unido)" },
  { value: "es-ES", label: "Espanhol" },
];

const TIMEZONES = ["Europe/Lisbon", "Atlantic/Azores", "UTC"];

const SELECT_CLASS = "h-10 w-full rounded-lg border border-caetano-medium-gray bg-white px-3 text-sm";

export default async function ProjectInfoStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requirePagePermission("campaign:edit");

  const campaign = await getCampaignForEditor(context.organizationId, id);
  if (!campaign) notFound();

  const workspaces = await prisma.workspace.findMany({
    where: { organizationId: context.organizationId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      folders: { where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } },
    },
  });

  // Uma pasta arquivada entretanto continua na lista enquanto a aplicação lá
  // estiver: sem a opção, o select mostrava "Sem pasta" e a gravação
  // seguinte tirava a aplicação da pasta sem ninguém o ter pedido.
  const currentFolder = campaign.folder;
  if (currentFolder?.archivedAt) {
    workspaces
      .find((workspace) => workspace.id === currentFolder.workspaceId)
      ?.folders.push({ id: currentFolder.id, name: `${currentFolder.name} (arquivada)` });
  }

  // Pela mesma razão, um idioma ou fuso fora das listas (definido noutro
  // sítio) aparece como opção em vez de ser trocado pelo primeiro.
  const locales = LOCALES.some((locale) => locale.value === campaign.locale)
    ? LOCALES
    : [...LOCALES, { value: campaign.locale, label: campaign.locale }];
  const timezones = TIMEZONES.includes(campaign.timezone) ? TIMEZONES : [...TIMEZONES, campaign.timezone];

  const hasParticipations = campaign._count.participations > 0;
  const slugLocked = Boolean(campaign.publishedAt);

  return (
    <div className="max-w-2xl">
      <h2 className="text-lg font-bold text-caetano-anthracite">Informações do projeto</h2>
      <p className="mt-1 text-sm text-caetano-anthracite-80">
        Dados internos de organização da campanha. O tipo de jogo (
        {CAMPAIGN_TYPE_LABELS[campaign.type]}) é definido na criação e não pode ser alterado
        {hasParticipations ? " — esta campanha já tem participações reais." : "."}
      </p>

      <AutoSaveForm action={updateProjectInfoAction} className="mt-6 space-y-4">
        <input type="hidden" name="campaignId" value={campaign.id} />

        <div>
          <Label htmlFor="internalName">Nome interno</Label>
          <Input
            id="internalName"
            name="internalName"
            maxLength={PROJECT_INFO_LIMITS.internalName}
            defaultValue={campaign.internalName}
            required
          />
        </div>

        <div>
          <Label htmlFor="publicTitle">Título público</Label>
          <Input
            id="publicTitle"
            name="publicTitle"
            maxLength={PROJECT_INFO_LIMITS.publicTitle}
            defaultValue={campaign.publicTitle ?? ""}
          />
        </div>

        <div>
          <Label htmlFor="internalReference">Referência interna</Label>
          <Input
            id="internalReference"
            name="internalReference"
            maxLength={PROJECT_INFO_LIMITS.internalReference}
            defaultValue={campaign.internalReference ?? ""}
          />
        </div>

        <WorkspaceFolderFields
          variant="editor"
          workspaces={workspaces}
          defaultWorkspaceId={campaign.workspaceId}
          defaultFolderId={campaign.folderId}
        />

        <div>
          <Label htmlFor="tags">Etiquetas (separadas por vírgula)</Label>
          <Input id="tags" name="tags" maxLength={PROJECT_INFO_LIMITS.tags} defaultValue={campaign.tags.join(", ")} />
        </div>

        <div>
          <Label htmlFor="description">Descrição</Label>
          <textarea
            id="description"
            name="description"
            maxLength={PROJECT_INFO_LIMITS.description}
            defaultValue={campaign.description ?? ""}
            rows={3}
            className="w-full rounded-lg border border-caetano-medium-gray px-3 py-2 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="locale">Idioma</Label>
            <SyncedSelect id="locale" name="locale" defaultValue={campaign.locale} className={SELECT_CLASS}>
              {locales.map((locale) => (
                <option key={locale.value} value={locale.value}>
                  {locale.label}
                </option>
              ))}
            </SyncedSelect>
          </div>
          <div>
            <Label htmlFor="timezone">Fuso horário</Label>
            <SyncedSelect
              id="timezone"
              name="timezone"
              defaultValue={campaign.timezone}
              aria-describedby="timezone-help"
              className={SELECT_CLASS}
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </SyncedSelect>
            <p id="timezone-help" className="mt-1 text-xs text-caetano-anthracite-80">
              As horas da agenda são lidas neste fuso.
            </p>
          </div>
        </div>

        <div>
          <Label htmlFor="slug">Endereço público (slug)</Label>
          {/* Desativado depois de publicar: não vai no envio e o servidor mantém-no. */}
          <Input
            id="slug"
            name="slug"
            maxLength={PROJECT_INFO_LIMITS.slug}
            defaultValue={campaign.slug}
            disabled={slugLocked}
            aria-describedby="slug-help"
          />
          <p id="slug-help" className="mt-1 text-xs text-caetano-anthracite-80">
            URL pública: /play/{campaign.slug}
            {slugLocked
              ? " — já não pode ser alterado depois de publicado (partia o link e o QR code já partilhados)."
              : " — letras minúsculas, números e hífenes."}
          </p>
        </div>
      </AutoSaveForm>
    </div>
  );
}
