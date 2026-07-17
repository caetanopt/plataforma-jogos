import Link from "next/link";
import {
  archiveCampaignAction,
  deleteCampaignAction,
  duplicateCampaignAction,
  restoreCampaignAction,
  togglePauseCampaignAction,
} from "@/features/campaigns/actions";
import { ConfirmSubmitButton } from "@/components/ui/confirm-submit-button";
import type { CampaignStatus } from "@/generated/prisma/client";

const menuItemClass =
  "block w-full rounded-md px-3 py-1.5 text-left text-sm text-caetano-anthracite hover:bg-neutral-100";

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
    <details className="relative inline-block text-left">
      <summary className="cursor-pointer list-none rounded-lg px-2 py-1 text-caetano-medium-gray hover:bg-neutral-100">
        ⋯
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-caetano-medium-gray/30 bg-white p-1 shadow-lg">
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
              className={`${menuItemClass} text-red-600`}
            >
              Eliminar
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    </details>
  );
}
