import type { Prisma } from "@/generated/prisma/client";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";
import type { PrivacyNoticeInput } from "@/features/publishing/readiness";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * O estado de que depende o aviso de privacidade de uma campanha (ver
 * `editRemovesLivePrivacyNotice`), para as ações do editor compararem o
 * antes e o depois de uma edição.
 */
export async function loadPrivacyNoticeState(campaignId: string, db: Db = prisma) {
  const campaign = await db.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: {
      status: true,
      legalText: true,
      theme: { select: { legalLinks: true } },
      leadForm: {
        select: {
          position: true,
          fields: { select: { type: true } },
          consentDefinitions: { select: { id: true } },
        },
      },
    },
  });
  const state: PrivacyNoticeInput = {
    legalText: campaign.legalText,
    theme: campaign.theme,
    leadForm: campaign.leadForm,
  };
  return { status: campaign.status, state };
}

/**
 * Verificar e gravar numa só transação, com a campanha bloqueada. Antes a
 * verificação lia fora de qualquer transação: duas edições ao mesmo tempo
 * (dois editores, dois separadores), cada uma permitida sozinha — apagar o
 * texto legal e tirar a política de privacidade —, deixavam juntas a
 * campanha publicada a pedir dados sem aviso. Com o bloqueio, a segunda
 * espera pela primeira e vê o que ela gravou.
 *
 * FOR NO KEY UPDATE: serializa as edições entre si sem fazer esperar quem
 * está a jogar (as participações novas só precisam de FOR KEY SHARE).
 */
export async function withPrivacyNoticeLock<T>(
  campaignId: string,
  fn: (tx: Prisma.TransactionClient, current: Awaited<ReturnType<typeof loadPrivacyNoticeState>>) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaignId} FOR NO KEY UPDATE`;
      return fn(tx, await loadPrivacyNoticeState(campaignId, tx));
    },
    { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: 15_000 },
  );
}
