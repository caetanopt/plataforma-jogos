"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
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
    include: { _count: { select: { participations: true } } },
  });
  if (!campaign) redirect("/apps?error=not_found");

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "DELETE",
    entityType: "Campaign",
    entityId: campaignId,
    result: "SUCCESS",
    metadata: { participationsDeleted: campaign._count.participations },
  });

  await prisma.campaign.delete({ where: { id: campaignId } });

  revalidatePath("/apps");
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
}

export async function togglePauseCampaignAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:publish");
  const campaignId = String(formData.get("campaignId") ?? "");

  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId: context.organizationId },
  });
  if (!campaign) redirect("/apps?error=not_found");
  if (campaign.status !== "PUBLISHED" && campaign.status !== "PAUSED") {
    redirect("/apps?error=invalid_state");
  }

  const nextStatus = campaign.status === "PUBLISHED" ? "PAUSED" : "PUBLISHED";
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
