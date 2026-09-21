import Link from "next/link";
import {
  archiveCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  restoreCampaignAction,
  togglePauseCampaignAction,
} from "@/features/campaigns/actions";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import { DetailsMenu, menuItemClass } from "@/components/ui/details-menu";
import type { CampaignStatus } from "@/generated/prisma/client";

export function CampaignRowActions({
  campaignId,
  status,
  canEdit,
  canPublish,
  canArchive,
  canDelete,
}: {
  campaignId: string;
  status: CampaignStatus;
  canEdit: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canDelete: boolean;
}) {
  return (
    <DetailsMenu label={<span aria-hidden="true">⋯</span>} ariaLabel="Ações da aplicação">
        {canEdit && (
          <Link href={`/apps/${campaignId}/informacoes`} className={menuItemClass}>
            Editar
          </Link>
        )}
        <Link href={`/apps/${campaignId}/publicar`} className={menuItemClass}>
          Pré-visualizar / testar
        </Link>
        <Link href={`/leads?campaignId=${campaignId}`} className={menuItemClass}>
          Leads
        </Link>
        <Link href={`/analytics?campaignId=${campaignId}`} className={menuItemClass}>
          Estatísticas
        </Link>

        {canEdit && (
          <form action={duplicateCampaignAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <button type="submit" className={menuItemClass}>
              Duplicar
            </button>
          </form>
        )}

        {canPublish && (status === "PUBLISHED" || status === "PAUSED" || status === "SCHEDULED") && (
          <form action={togglePauseCampaignAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <button type="submit" className={menuItemClass}>
              {status === "PAUSED" ? "Retomar" : "Pausar"}
            </button>
          </form>
        )}

        {canArchive && status !== "ARCHIVED" && (
          <form action={archiveCampaignAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <button type="submit" className={menuItemClass}>
              Arquivar
            </button>
          </form>
        )}

        {canArchive && status === "ARCHIVED" && (
          <form action={restoreCampaignAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <button type="submit" className={menuItemClass}>
              Restaurar
            </button>
          </form>
        )}

        {canDelete && (
          <form action={deleteCampaignAction}>
            <input type="hidden" name="campaignId" value={campaignId} />
            <ConfirmSubmitButton
              confirmMessage="Eliminar esta aplicação apaga também todas as participações e leads associados. Esta ação não pode ser desfeita. Continuar?"
              variant="ghost"
              size="sm"
              className={`${menuItemClass} text-danger`}
            >
              Eliminar
            </ConfirmSubmitButton>
          </form>
        )}
    </DetailsMenu>
  );
}
