"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { databaseErrorKind, runAction } from "@/server/actions/run-action";
import { PROJECT_INFO_MESSAGES, projectInfoShape } from "@/lib/validation/campaign";
import { slugify } from "@/lib/random/slug";
import { emptyToNull, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { partialResult, type ActionResult } from "@/lib/forms/action-result";
import { sameWallClockIn } from "@/lib/dates/timezone";

/**
 * Muda o fuso da campanha. A data de anonimização (§24) foi escolhida como
 * um dia no fuso da campanha ("Numa data": 00:00 desse dia): continua a ser
 * esse dia no fuso novo, em vez de o editor passar a mostrar a véspera (ou o
 * dia seguinte) e de a anonimização mudar de dia. Com a campanha bloqueada,
 * como a gravação do prazo (privacy/actions.ts): nenhuma das duas lê o fuso
 * ou a data antes de a outra acabar.
 */
async function moveCampaignTimezone(campaignId: string, timezone: string) {
  return prisma.$transaction(
    async (tx) => {
      const [current] = await tx.$queryRaw<Array<{ timezone: string; dataRetentionUntil: Date | null }>>`
        SELECT "timezone", "dataRetentionUntil" FROM "Campaign" WHERE "id" = ${campaignId} FOR NO KEY UPDATE`;
      if (!current || current.timezone === timezone) return null;
      const until = current.dataRetentionUntil ? sameWallClockIn(current.dataRetentionUntil, current.timezone, timezone) : null;
      await tx.campaign.update({ where: { id: campaignId }, data: { timezone, ...(until ? { dataRetentionUntil: until } : {}) } });
      return { timezoneBefore: current.timezone, untilBefore: current.dataRetentionUntil, untilAfter: until };
    },
    { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: 15_000 },
  );
}

export async function updateProjectInfoAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateProjectInfo", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, organizationId: context.organizationId },
      select: { id: true, slug: true, publishedAt: true, workspaceId: true, folderId: true, timezone: true },
    });
    if (!campaign) notFound();

    const parse = parsePartial(projectInfoShape, {
      internalName: readOptional(formData, "internalName"),
      publicTitle: readOptional(formData, "publicTitle"),
      internalReference: readOptional(formData, "internalReference"),
      workspaceId: readOptional(formData, "workspaceId"),
      folderId: readOptional(formData, "folderId"),
      tags: readOptional(formData, "tags"),
      description: readOptional(formData, "description"),
      locale: readOptional(formData, "locale"),
      timezone: readOptional(formData, "timezone"),
      slug: readOptional(formData, "slug"),
    });
    const { data, fieldErrors } = parse;

    // Espaço de trabalho: só um da própria organização (isolamento multi-tenant).
    if (data.workspaceId !== undefined && data.workspaceId !== campaign.workspaceId) {
      const workspace = await prisma.workspace.findFirst({
        where: { id: data.workspaceId, organizationId: context.organizationId },
        select: { id: true },
      });
      if (!workspace) rejectField(parse, "workspaceId", PROJECT_INFO_MESSAGES.workspaceNotFound);
    }
    const workspaceId = data.workspaceId ?? campaign.workspaceId;

    // A pasta tem de ser do espaço de trabalho que fica gravado — a enviada
    // ou, ao mudar só de espaço, a que já estava. Se não for, a aplicação
    // fica sem pasta (e diz-se porquê) em vez de se perder o resto do
    // formulário ou de ficar numa pasta de outro espaço.
    let folderId = emptyToNull(data.folderId);
    const folderToCheck = folderId !== undefined ? folderId : workspaceId !== campaign.workspaceId ? campaign.folderId : null;
    if (folderToCheck) {
      const folder = await prisma.folder.findFirst({
        where: { id: folderToCheck, workspaceId },
        select: { id: true },
      });
      if (!folder) {
        folderId = null;
        fieldErrors.folderId = PROJECT_INFO_MESSAGES.folderOutsideWorkspace;
      }
    }

    // O valor gravado volta em cada gravação automática: igual ao atual não
    // passa pelo `slugify`, que o cortava aos 60 caracteres.
    let slug: string | undefined;
    if (data.slug !== undefined && data.slug !== campaign.slug) {
      const candidate = slugify(data.slug);
      if (campaign.publishedAt) {
        // Uma vez publicada, mudar o slug parte o link e o QR code já
        // partilhados (a imagem do QR fica com a URL antiga, agora um 404
        // livre para outra campanha reclamar). A página desativa o campo.
        if (candidate !== campaign.slug) rejectField(parse, "slug", PROJECT_INFO_MESSAGES.slugLocked);
      } else if (!candidate) {
        rejectField(parse, "slug", PROJECT_INFO_MESSAGES.slugEmpty);
      } else if (candidate !== campaign.slug) {
        const taken = await prisma.campaign.findUnique({ where: { slug: candidate }, select: { id: true } });
        if (taken) rejectField(parse, "slug", PROJECT_INFO_MESSAGES.slugTaken);
        else slug = candidate;
      }
    }

    const tags =
      data.tags === undefined
        ? undefined
        : data.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean);

    const update = {
      internalName: data.internalName,
      publicTitle: emptyToNull(data.publicTitle),
      internalReference: emptyToNull(data.internalReference),
      workspaceId: data.workspaceId,
      folderId,
      tags,
      description: emptyToNull(data.description),
      locale: data.locale,
      slug,
    };
    const hasValues = () => Object.values(update).some((value) => value !== undefined);
    let savedSomething = hasValues();
    const timezoneChange = data.timezone !== undefined && data.timezone !== campaign.timezone ? data.timezone : null;

    if (savedSomething) {
      try {
        await prisma.campaign.update({ where: { id: campaign.id }, data: update });
      } catch (error) {
        // Outra campanha ficou com o endereço entre a verificação e a
        // gravação: grava-se o resto e o endereço volta com o erro.
        if (update.slug === undefined || databaseErrorKind(error) !== "unique") throw error;
        fieldErrors.slug = PROJECT_INFO_MESSAGES.slugTaken;
        update.slug = undefined;
        savedSomething = hasValues();
        if (savedSomething) await prisma.campaign.update({ where: { id: campaign.id }, data: update });
      }
    }
    // O fuso à parte, com a data de anonimização que depende dele.
    const moved = timezoneChange ? await moveCampaignTimezone(campaign.id, timezoneChange) : null;
    if (moved) savedSomething = true;

    if (savedSomething) {
      await logAudit({
        organizationId: context.organizationId,
        userId: context.userId,
        action: "UPDATE",
        entityType: "Campaign",
        entityId: campaign.id,
        result: "SUCCESS",
        metadata: {
          step: "informacoes",
          // Mudam o link público e quem vê a campanha: antes/depois (§26).
          ...(update.slug !== undefined && { slugBefore: campaign.slug, slugAfter: update.slug }),
          ...(update.workspaceId !== undefined &&
            update.workspaceId !== campaign.workspaceId && {
              workspaceBefore: campaign.workspaceId,
              workspaceAfter: update.workspaceId,
            }),
          ...(moved && {
            timezoneBefore: moved.timezoneBefore,
            timezoneAfter: timezoneChange,
            ...(moved.untilAfter && {
              dataRetentionUntilBefore: moved.untilBefore?.toISOString() ?? null,
              dataRetentionUntilAfter: moved.untilAfter.toISOString(),
            }),
          }),
        },
      });

      revalidatePath(`/apps/${campaign.id}/informacoes`);
      revalidatePath(`/apps/${campaign.id}`);
      if (moved?.untilAfter) revalidatePath(`/apps/${campaign.id}/formulario`);
    }

    return partialResult(fieldErrors, savedSomething);
  });
}
