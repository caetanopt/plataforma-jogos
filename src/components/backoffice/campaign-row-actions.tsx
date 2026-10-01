import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ChartColumn,
  Copy,
  Ellipsis,
  Eye,
  Pause,
  Pencil,
  Play,
  Trash2,
  Users,
} from "lucide-react";
import {
  archiveCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  restoreCampaignAction,
  togglePauseCampaignAction,
} from "@/features/campaigns/actions";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { DetailsMenu } from "@/components/ui/details-menu";
import { cn } from "@/lib/utils";
import { menuItemClass } from "@/components/ui/menu-classes";
import type { CampaignStatus } from "@/generated/prisma/client";

/*
  Item com ícone (o ícone é decorativo; o nome acessível continua a ser o
  texto): o `menuItemClass` dos menus, com o ícone ao lado. Vem de
  menu-classes.ts, sem "use client": importado de details-menu.tsx, neste
  Server Component era uma referência de cliente, e concatenado dava o
  código de uma função dentro do `class`.
*/
const itemClass = cn(menuItemClass, "flex items-center gap-2.5");
const iconClass = "shrink-0 text-caetano-anthracite-80";

/** Separa os grupos de ações (abrir, alterar, eliminar). Só visual. */
function MenuDivider() {
  return <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-caetano-medium-gray-40" />;
}

export function CampaignRowActions({
  campaignId,
  status,
  canEdit,
  canViewLeads,
  canPublish,
  canArchive,
  canDelete,
  openUpward = false,
}: {
  campaignId: string;
  status: CampaignStatus;
  canEdit: boolean;
  /** Sem leads:view (Visualizador, Editor) a ligação acabava em "Sem permissão". */
  canViewLeads: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canDelete: boolean;
  /**
   * Abrir o menu para cima: nas últimas linhas da tabela, um menu que abre
   * para baixo fica cortado pelo contentor com scroll horizontal.
   */
  openUpward?: boolean;
}) {
  const canTogglePause = canPublish && (status === "PUBLISHED" || status === "PAUSED" || status === "SCHEDULED");
  const hasChanges = canEdit || canTogglePause || canArchive;

  return (
    <DetailsMenu
      label={<Ellipsis size={18} aria-hidden="true" />}
      ariaLabel="Ações da aplicação"
      summaryClassName="h-10 w-10 rounded-xl hover:text-caetano-deep-blue [[open]>&]:text-caetano-deep-blue"
      panelClassName={cn("w-60", openUpward && "bottom-full mb-1.5 mt-0 origin-bottom-right")}
    >
      {canEdit && (
        <Link href={`/apps/${campaignId}/informacoes`} className={itemClass}>
          <Pencil size={16} aria-hidden="true" className={iconClass} />
          Editar
        </Link>
      )}
      {/* A pré-visualização vive no editor (exige campaign:edit). */}
      {canEdit && (
        <Link href={`/apps/${campaignId}/publicar`} className={itemClass}>
          <Eye size={16} aria-hidden="true" className={iconClass} />
          Pré-visualizar / testar
        </Link>
      )}
      {canViewLeads && (
        <Link href={`/leads?campaignId=${campaignId}`} className={itemClass}>
          <Users size={16} aria-hidden="true" className={iconClass} />
          Leads
        </Link>
      )}
      <Link href={`/analytics?campaignId=${campaignId}`} className={itemClass}>
        <ChartColumn size={16} aria-hidden="true" className={iconClass} />
        Estatísticas
      </Link>

      {hasChanges && <MenuDivider />}

      {canEdit && (
        <form action={duplicateCampaignAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <button type="submit" className={itemClass}>
            <Copy size={16} aria-hidden="true" className={iconClass} />
            Duplicar
          </button>
        </form>
      )}

      {canTogglePause && (
        <form action={togglePauseCampaignAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <button type="submit" className={itemClass}>
            {status === "PAUSED" ? (
              <Play size={16} aria-hidden="true" className={iconClass} />
            ) : (
              <Pause size={16} aria-hidden="true" className={iconClass} />
            )}
            {status === "PAUSED" ? "Retomar" : "Pausar"}
          </button>
        </form>
      )}

      {canArchive && status !== "ARCHIVED" && (
        <form action={archiveCampaignAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <button type="submit" className={itemClass}>
            <Archive size={16} aria-hidden="true" className={iconClass} />
            Arquivar
          </button>
        </form>
      )}

      {canArchive && status === "ARCHIVED" && (
        <form action={restoreCampaignAction}>
          <input type="hidden" name="campaignId" value={campaignId} />
          <button type="submit" className={itemClass}>
            <ArchiveRestore size={16} aria-hidden="true" className={iconClass} />
            Restaurar
          </button>
        </form>
      )}

      {canDelete && (
        <>
          <MenuDivider />
          <form action={deleteCampaignAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <ConfirmSubmitButton
              // O título do diálogo vinha do texto do botão; com o ícone ao
              // lado deixou de ser só texto, por isso fica explícito.
              confirmTitle="Eliminar"
              confirmMessage="Eliminar esta aplicação apaga também todas as participações e leads associados. Esta ação não pode ser desfeita. Continuar?"
              variant="ghost"
              size="sm"
              className={cn(itemClass, "h-auto justify-start font-normal text-danger hover:bg-danger-surface active:bg-danger-surface")}
            >
              <Trash2 size={16} aria-hidden="true" className="shrink-0" />
              Eliminar
            </ConfirmSubmitButton>
          </form>
        </>
      )}
    </DetailsMenu>
  );
}
