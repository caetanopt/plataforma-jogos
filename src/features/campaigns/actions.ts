"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";
import { retryOnDeadlock } from "@/lib/db/transaction-retry";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { createCampaignSchema } from "@/lib/validation/campaign";
import { generateCampaignSlug } from "@/lib/random/slug";
import { createCampaignTheme } from "@/features/campaigns/theme";
import type { CampaignType } from "@/generated/prisma/client";

const DEFAULT_NAME_BY_TYPE: Record<CampaignType, string> = {
  MEMORY: "Novo Jogo da Memória",
  WHEEL: "Nova Roda da Sorte",
  QUIZ: "Novo Quiz Interativo",
};

async function ensureUniqueSlug(base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt}`;
    const existing = await prisma.campaign.findUnique({ where: { slug }, select: { id: true } });
    if (!existing) return slug;
  }
  return `${base}-${Date.now()}`;
}

export async function createCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:create");

  const parsed = createCampaignSchema.safeParse({
    type: formData.get("type"),
    workspaceId: formData.get("workspaceId"),
    folderId: formData.get("folderId") || undefined,
  });
  if (!parsed.success) {
    redirect("/apps/new?error=validation");
  }

  const { type, workspaceId, folderId } = parsed.data;

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, organizationId: context.organizationId },
  });
  if (!workspace) {
    redirect("/apps/new?error=validation");
  }

  if (folderId) {
    const folder = await prisma.folder.findFirst({ where: { id: folderId, workspaceId } });
    if (!folder) {
      redirect("/apps/new?error=validation");
    }
  }

  const theme = await createCampaignTheme(context.organizationId);
  const slug = await ensureUniqueSlug(generateCampaignSlug(type.toLowerCase()));

  const campaign = await prisma.campaign.create({
    data: {
      organizationId: context.organizationId,
      workspaceId,
      folderId,
      type,
      internalName: DEFAULT_NAME_BY_TYPE[type],
      ownerId: context.userId,
      slug,
      themeId: theme.id,
      leadForm: { create: { position: "BEFORE_GAME" } },
      ...(type === "MEMORY" ? { memoryConfig: { create: {} } } : {}),
      ...(type === "WHEEL" ? { wheelConfig: { create: {} } } : {}),
      ...(type === "QUIZ" ? { quizConfig: { create: {} } } : {}),
    },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "Campaign",
    entityId: campaign.id,
    result: "SUCCESS",
    metadata: { type },
  });

  // A contagem de aplicações por pasta aparece na página inicial.
  revalidatePath("/folders");

  redirect(`/apps/${campaign.id}/informacoes`);
}

export async function duplicateCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:create");

  const campaignId = String(formData.get("campaignId") ?? "");
  const original = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
    include: {
      screens: true,
      leadForm: { include: { fields: true, consentDefinitions: true } },
      memoryConfig: { include: { pairs: true } },
      wheelConfig: { include: { segments: true } },
      quizConfig: { include: { questions: { include: { answers: true } }, resultProfiles: true } },
      prizes: true,
      theme: true,
    },
  });
  if (!original) {
    redirect("/apps?error=not_found");
  }

  const newTheme = original.theme
    ? await prisma.campaignTheme.create({
        data: {
          organizationId: context.organizationId,
          name: `${original.theme.name} (cópia)`,
          isBrandKit: false,
          sourceBrandKitId: original.theme.sourceBrandKitId,
          logoMediaId: original.theme.logoMediaId,
          faviconMediaId: original.theme.faviconMediaId,
          backgroundImageMediaId: original.theme.backgroundImageMediaId,
          primaryColor: original.theme.primaryColor,
          secondaryColor: original.theme.secondaryColor,
          backgroundColor: original.theme.backgroundColor,
          textColor: original.theme.textColor,
          buttonColor: original.theme.buttonColor,
          buttonTextColor: original.theme.buttonTextColor,
          fontFamily: original.theme.fontFamily,
          borderRadiusPx: original.theme.borderRadiusPx,
          shadowEnabled: original.theme.shadowEnabled,
          headerConfig: original.theme.headerConfig ?? undefined,
          footerConfig: original.theme.footerConfig ?? undefined,
          legalLinks: original.theme.legalLinks ?? undefined,
        },
      })
    : await createCampaignTheme(context.organizationId);

  const slug = await ensureUniqueSlug(generateCampaignSlug(original.internalName));

  const duplicate = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: original.workspaceId,
        folderId: original.folderId,
        type: original.type,
        status: "DRAFT",
        internalName: `${original.internalName} (cópia)`,
        publicTitle: original.publicTitle,
        internalReference: original.internalReference,
        tags: original.tags,
        ownerId: context.userId,
        description: original.description,
        locale: original.locale,
        timezone: original.timezone,
        slug,
        themeId: newTheme.id,
        startTitle: original.startTitle,
        startSubtitle: original.startSubtitle,
        startIntroText: original.startIntroText,
        startMediaId: original.startMediaId,
        startLogoMediaId: original.startLogoMediaId,
        startButtonLabel: original.startButtonLabel,
        startPrizeInfo: original.startPrizeInfo,
        countdownEnabled: original.countdownEnabled,
        regulationText: original.regulationText,
        legalText: original.legalText,
        participationLimitType: original.participationLimitType,
        participationCustomMax: original.participationCustomMax,
        dedupStrategies: original.dedupStrategies,
        dedupFieldCombination: original.dedupFieldCombination,
        minAge: original.minAge,
        // O prazo em dias copia-se; a data não: era a do fim da campanha
        // original, e numa cópia que corre depois anonimizava cada lead um
        // dia depois de chegar.
        dataRetentionDays: original.dataRetentionDays,
        finalTitle: original.finalTitle,
        finalMessage: original.finalMessage,
        finalMediaId: original.finalMediaId,
        finalCtaLabel: original.finalCtaLabel,
        finalCtaUrl: original.finalCtaUrl,
        finalAllowReplay: original.finalAllowReplay,
        finalAllowShare: original.finalAllowShare,
      },
    });

    for (const screen of original.screens) {
      await tx.campaignScreen.create({
        data: {
          campaignId: created.id,
          kind: screen.kind,
          // Sem isto, um ecrã desligado voltava ligado na cópia (o default é true).
          enabled: screen.enabled,
          title: screen.title,
          text: screen.text,
          mediaId: screen.mediaId,
          ctaLabel: screen.ctaLabel,
          ctaUrl: screen.ctaUrl,
          continueButtonLabel: screen.continueButtonLabel,
        },
      });
    }

    if (original.leadForm) {
      const newLeadForm = await tx.leadForm.create({
        data: {
          campaignId: created.id,
          position: original.leadForm.position,
          honeypotEnabled: original.leadForm.honeypotEnabled,
        },
      });
      for (const field of original.leadForm.fields) {
        await tx.leadFormField.create({
          data: {
            leadFormId: newLeadForm.id,
            type: field.type,
            internalKey: field.internalKey,
            label: field.label,
            placeholder: field.placeholder,
            helpText: field.helpText,
            required: field.required,
            order: field.order,
            validationRegex: field.validationRegex,
            defaultValue: field.defaultValue,
            options: field.options ?? undefined,
            exportMapping: field.exportMapping,
          },
        });
      }
      for (const consent of original.leadForm.consentDefinitions) {
        await tx.consentDefinition.create({
          data: {
            leadFormId: newLeadForm.id,
            text: consent.text,
            version: consent.version,
            isMarketing: consent.isMarketing,
            required: consent.required,
            order: consent.order,
          },
        });
      }
    }

    const newPrizeIdByOldId = new Map<string, string>();
    for (const prize of original.prizes) {
      const newPrize = await tx.prize.create({
        data: {
          campaignId: created.id,
          internalName: prize.internalName,
          publicName: prize.publicName,
          description: prize.description,
          imageMediaId: prize.imageMediaId,
          totalQuantity: prize.totalQuantity,
          awardedQuantity: 0,
          dailyLimit: prize.dailyLimit,
          instructions: prize.instructions,
          terms: prize.terms,
          isActive: prize.isActive,
          startAt: prize.startAt,
          endAt: prize.endAt,
        },
      });
      newPrizeIdByOldId.set(prize.id, newPrize.id);
    }

    if (original.memoryConfig) {
      const newMemoryConfig = await tx.memoryGameConfig.create({
        data: {
          campaignId: created.id,
          columns: original.memoryConfig.columns,
          randomizeOrder: original.memoryConfig.randomizeOrder,
          cardAspectRatio: original.memoryConfig.cardAspectRatio,
          cardGapPx: original.memoryConfig.cardGapPx,
          timeLimitSeconds: original.memoryConfig.timeLimitSeconds,
          maxAttempts: original.memoryConfig.maxAttempts,
          pointsPerPair: original.memoryConfig.pointsPerPair,
          penaltyPerMistake: original.memoryConfig.penaltyPerMistake,
          speedBonusEnabled: original.memoryConfig.speedBonusEnabled,
          previewSeconds: original.memoryConfig.previewSeconds,
          soundEnabled: original.memoryConfig.soundEnabled,
          rankingEnabled: original.memoryConfig.rankingEnabled,
          rankingMaxEntries: original.memoryConfig.rankingMaxEntries,
          rankingAnonymize: original.memoryConfig.rankingAnonymize,
          cardBackMediaId: original.memoryConfig.cardBackMediaId,
        },
      });
      for (const pair of original.memoryConfig.pairs) {
        await tx.memoryCardPair.create({
          data: {
            memoryGameConfigId: newMemoryConfig.id,
            order: pair.order,
            kind: pair.kind,
            cardAMediaId: pair.cardAMediaId,
            cardAText: pair.cardAText,
            cardAAltText: pair.cardAAltText,
            cardBMediaId: pair.cardBMediaId,
            cardBText: pair.cardBText,
            cardBAltText: pair.cardBAltText,
          },
        });
      }
    }

    if (original.wheelConfig) {
      const newWheelConfig = await tx.wheelConfig.create({ data: { campaignId: created.id } });
      for (const segment of original.wheelConfig.segments) {
        await tx.wheelSegment.create({
          data: {
            wheelConfigId: newWheelConfig.id,
            order: segment.order,
            name: segment.name,
            colorHex: segment.colorHex,
            imageMediaId: segment.imageMediaId,
            outcome: segment.outcome,
            prizeId: segment.prizeId ? newPrizeIdByOldId.get(segment.prizeId) : undefined,
            weight: segment.weight,
            totalQuantity: segment.totalQuantity,
            remainingQuantity: segment.totalQuantity,
            periodStart: segment.periodStart,
            periodEnd: segment.periodEnd,
            message: segment.message,
            code: segment.code,
            isActive: segment.isActive,
          },
        });
      }
    }

    if (original.quizConfig) {
      const newQuizConfig = await tx.quizConfig.create({
        data: {
          campaignId: created.id,
          questionsPerParticipation: original.quizConfig.questionsPerParticipation,
          randomizeQuestionOrder: original.quizConfig.randomizeQuestionOrder,
          randomizeAnswerOrder: original.quizConfig.randomizeAnswerOrder,
          totalTimeLimitSeconds: original.quizConfig.totalTimeLimitSeconds,
          perQuestionTimeLimitSeconds: original.quizConfig.perQuestionTimeLimitSeconds,
          penaltyPerWrong: original.quizConfig.penaltyPerWrong,
          speedBonusEnabled: original.quizConfig.speedBonusEnabled,
          allowGoBack: original.quizConfig.allowGoBack,
          showProgress: original.quizConfig.showProgress,
          showCorrectAnswer: original.quizConfig.showCorrectAnswer,
          showExplanation: original.quizConfig.showExplanation,
          minPassPercentage: original.quizConfig.minPassPercentage,
          maxAttempts: original.quizConfig.maxAttempts,
        },
      });
      for (const question of original.quizConfig.questions) {
        const newQuestion = await tx.quizQuestion.create({
          data: {
            quizConfigId: newQuizConfig.id,
            order: question.order,
            type: question.type,
            title: question.title,
            supportText: question.supportText,
            imageMediaId: question.imageMediaId,
            points: question.points,
            timeLimitSeconds: question.timeLimitSeconds,
            explanation: question.explanation,
            required: question.required,
            immediateFeedback: question.immediateFeedback,
          },
        });
        for (const answer of question.answers) {
          await tx.quizAnswer.create({
            data: {
              questionId: newQuestion.id,
              order: answer.order,
              text: answer.text,
              imageMediaId: answer.imageMediaId,
              isCorrect: answer.isCorrect,
            },
          });
        }
      }
      for (const profile of original.quizConfig.resultProfiles) {
        await tx.quizResultProfile.create({
          data: {
            quizConfigId: newQuizConfig.id,
            minPercentage: profile.minPercentage,
            maxPercentage: profile.maxPercentage,
            title: profile.title,
            description: profile.description,
            imageMediaId: profile.imageMediaId,
            ctaLabel: profile.ctaLabel,
            ctaUrl: profile.ctaUrl,
          },
        });
      }
    }

    return created;
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "Campaign",
    entityId: duplicate.id,
    result: "SUCCESS",
    metadata: { duplicatedFrom: original.id },
  });

  revalidatePath("/apps");
  // A contagem de aplicações por pasta aparece na página inicial.
  revalidatePath("/folders");
  redirect(`/apps/${duplicate.id}/informacoes`);
}

export async function archiveCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:archive");
  const campaignId = String(formData.get("campaignId") ?? "");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) redirect("/apps?error=not_found");

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "ARCHIVED", archivedAt: new Date() },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "ARCHIVE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
  });

  revalidatePath("/apps");
}

export async function restoreCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:archive");
  const campaignId = String(formData.get("campaignId") ?? "");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) redirect("/apps?error=not_found");

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "DRAFT", archivedAt: null },
  });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { action: "restore" },
  });

  revalidatePath("/apps");
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:delete");
  const campaignId = String(formData.get("campaignId") ?? "");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
    select: { id: true },
  });
  if (!campaign) redirect("/apps?error=not_found");

  // Por ordem, numa só transação. Participation.campaignVersionId,
  // ConsentRecord.consentDefinitionId e PrizeAward.prizeId são RESTRICT: com
  // um único DELETE da campanha, o resultado dependia da ordem em que o
  // Postgres dispara as cascatas (a do nome interno dos triggers, que muda
  // quando uma FK é recriada) — com a dos prémios antes da das participações
  // dava P2003, e o ecrã de erro depois de confirmar. As participações levam
  // com elas os prémios atribuídos, os consentimentos e as respostas. O FOR
  // UPDATE faz esperar as participações que comecem entretanto (a inserção
  // precisa da campanha) e a anonimização (que bloqueia a campanha primeiro),
  // em vez de uma delas travar a eliminação a meio.
  //
  // O Participant liga-se só à organização: sem isto, o nome, o e-mail e o
  // telefone gravados nele (antes de a identidade passar para a participação)
  // sobreviviam à eliminação que o aviso diz apagar tudo (§24). Saem os que
  // só participaram nesta campanha; quem jogou também noutra fica (o
  // identificador do browser serve os limites de participação de lá).
  //
  // Os candidatos (quem jogou aqui) ficam registados e bloqueados antes de
  // tudo, por ordem de id; depois saem as participações e, por fim, os
  // candidatos que ficaram sem nenhuma. Apagar os participantes primeiro
  // obrigava o SET NULL a reescrever cada participação antes de a apagar
  // (numa campanha grande, segundos) e cruzava a ordem dos bloqueios com a
  // de um sorteio a decorrer. O bloqueio espera por uma participação a
  // começar noutra campanha com o mesmo participante, e o DELETE final, uma
  // instrução nova, já a vê.
  //
  // Sem prazo explícito, o Prisma dava 5 s à transação inteira: uma campanha
  // com 100 mil participações nunca se conseguia eliminar.
  const { participantsDeleted, participations } = await retryOnDeadlock(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${campaign.id} FOR UPDATE`;
        const candidates = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Participant"
          WHERE "organizationId" = ${context.organizationId}
            AND "id" IN (SELECT "participantId" FROM "Participation" WHERE "campaignId" = ${campaign.id})
          ORDER BY "id"
          FOR UPDATE`;
        const deletedParticipations = await tx.participation.deleteMany({ where: { campaignId: campaign.id } });
        const candidateIds = candidates.map((row) => row.id);
        const deletedParticipants =
          candidateIds.length > 0
            ? await tx.$executeRaw`
                DELETE FROM "Participant" p
                WHERE p."organizationId" = ${context.organizationId}
                  AND p."id" = ANY(${candidateIds}::text[])
                  AND NOT EXISTS (SELECT 1 FROM "Participation" x WHERE x."participantId" = p."id")`
            : 0;
        // Os que ficam (jogaram noutra campanha) perdem os dados pessoais
        // antigos: podiam ser de quem jogou nesta.
        if (candidateIds.length > 0) {
          await tx.$executeRaw`
            UPDATE "Participant"
            SET "email" = NULL, "phone" = NULL, "firstName" = NULL, "lastName" = NULL, "anonymizedAt" = ${new Date()}
            WHERE "organizationId" = ${context.organizationId}
              AND "id" = ANY(${candidateIds}::text[])
              AND ("email" IS NOT NULL OR "phone" IS NOT NULL OR "firstName" IS NOT NULL OR "lastName" IS NOT NULL)`;
        }
        await tx.campaignVersion.deleteMany({ where: { campaignId: campaign.id } });
        await tx.campaign.delete({ where: { id: campaign.id } });
        return { participantsDeleted: deletedParticipants, participations: deletedParticipations };
      },
      { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: 120_000 },
    ),
  );

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "DELETE",
    entityType: "Campaign",
    entityId: campaign.id,
    result: "SUCCESS",
    metadata: { participationsDeleted: participations.count, participantsDeleted },
  });
  // A eliminação dos dados pessoais também fica como operação de privacidade
  // (§26), só com as contagens.
  if (participations.count > 0 || participantsDeleted > 0) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "PRIVACY_OPERATION",
      entityType: "Campaign",
      entityId: campaign.id,
      result: "SUCCESS",
      metadata: { operation: "campaign_delete", participationsDeleted: participations.count, participantsDeleted },
    });
  }

  revalidatePath("/apps");
  // A contagem de aplicações por pasta aparece na página inicial.
  revalidatePath("/folders");
}

export async function moveCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");
  const campaignId = String(formData.get("campaignId") ?? "");
  const folderId = String(formData.get("folderId") ?? "") || null;

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) redirect("/apps?error=not_found");

  if (folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: folderId, workspaceId: campaign.workspaceId },
    });
    if (!folder) redirect("/apps?error=validation");
  }

  await prisma.campaign.update({ where: { id: campaignId }, data: { folderId } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "UPDATE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { action: "move", folderId },
  });

  revalidatePath("/apps");
  // A contagem de aplicações por pasta aparece na página inicial.
  revalidatePath("/folders");
}

export async function togglePauseCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:publish");
  const campaignId = String(formData.get("campaignId") ?? "");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) redirect("/apps?error=not_found");
  // Uma campanha "Agendada" cuja data de início já passou está efetivamente
  // ativa (ver getEffectivePublicState) e tinha de poder ser pausada — antes
  // só PUBLISHED/PAUSED eram aceites, deixando essas campanhas presas sem
  // nenhum caminho de UI para as pausar.
  if (campaign.status !== "PUBLISHED" && campaign.status !== "PAUSED" && campaign.status !== "SCHEDULED") {
    redirect("/apps?error=invalid_state");
  }

  const nextStatus = campaign.status === "PAUSED" ? "PUBLISHED" : "PAUSED";
  await prisma.campaign.update({ where: { id: campaignId }, data: { status: nextStatus } });

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: nextStatus === "PAUSED" ? "PAUSE" : "PUBLISH",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
  });

  revalidatePath("/apps");
}
