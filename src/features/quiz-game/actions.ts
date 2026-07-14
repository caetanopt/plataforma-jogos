"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import {
  addAnswerSchema,
  addQuestionSchema,
  quizConfigSchema,
  resultProfileSchema,
  updateQuestionSchema,
} from "@/lib/validation/quiz-game";
import { getField } from "@/lib/forms/form-data";

async function getOwnedQuizConfig(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, type: "QUIZ" },
    include: { quizConfig: true },
  });
  return campaign?.quizConfig ? { campaign, quizConfig: campaign.quizConfig } : null;
}

export async function updateQuizConfigAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = quizConfigSchema.safeParse({
    questionsPerParticipation: getField(formData, "questionsPerParticipation") || undefined,
    randomizeQuestionOrder: getField(formData, "randomizeQuestionOrder"),
    randomizeAnswerOrder: getField(formData, "randomizeAnswerOrder"),
    totalTimeLimitSeconds: getField(formData, "totalTimeLimitSeconds") || undefined,
    perQuestionTimeLimitSeconds: getField(formData, "perQuestionTimeLimitSeconds") || undefined,
    penaltyPerWrong: getField(formData, "penaltyPerWrong"),
    speedBonusEnabled: getField(formData, "speedBonusEnabled"),
    allowGoBack: getField(formData, "allowGoBack"),
    showProgress: getField(formData, "showProgress"),
    showCorrectAnswer: getField(formData, "showCorrectAnswer"),
    showExplanation: getField(formData, "showExplanation"),
    minPassPercentage: getField(formData, "minPassPercentage") || undefined,
    maxAttempts: getField(formData, "maxAttempts") || undefined,
  });
  if (!parsed.success) return;

  await prisma.quizConfig.update({
    where: { id: owned.quizConfig.id },
    data: {
      questionsPerParticipation: parsed.data.questionsPerParticipation ?? null,
      randomizeQuestionOrder: parsed.data.randomizeQuestionOrder === "on",
      randomizeAnswerOrder: parsed.data.randomizeAnswerOrder === "on",
      totalTimeLimitSeconds: parsed.data.totalTimeLimitSeconds ?? null,
      perQuestionTimeLimitSeconds: parsed.data.perQuestionTimeLimitSeconds ?? null,
      penaltyPerWrong: parsed.data.penaltyPerWrong,
      speedBonusEnabled: parsed.data.speedBonusEnabled === "on",
      allowGoBack: parsed.data.allowGoBack === "on",
      showProgress: parsed.data.showProgress === "on",
      showCorrectAnswer: parsed.data.showCorrectAnswer === "on",
      showExplanation: parsed.data.showExplanation === "on",
      minPassPercentage: parsed.data.minPassPercentage ?? null,
      maxAttempts: parsed.data.maxAttempts ?? null,
    },
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function addQuestionAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = addQuestionSchema.safeParse({
    type: getField(formData, "type"),
    title: getField(formData, "title"),
  });
  if (!parsed.success) return;

  const existing = await prisma.quizQuestion.findMany({
    where: { quizConfigId: owned.quizConfig.id },
    select: { order: true },
  });
  const nextOrder = existing.reduce((max, q) => Math.max(max, q.order), -1) + 1;

  const question = await prisma.quizQuestion.create({
    data: {
      quizConfigId: owned.quizConfig.id,
      order: nextOrder,
      type: parsed.data.type,
      title: parsed.data.title,
    },
  });

  if (parsed.data.type === "TRUE_FALSE") {
    await prisma.quizAnswer.createMany({
      data: [
        { questionId: question.id, order: 0, text: "Verdadeiro", isCorrect: true },
        { questionId: question.id, order: 1, text: "Falso", isCorrect: false },
      ],
    });
  }

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "CREATE",
    entityType: "QuizQuestion",
    entityId: question.id,
    result: "SUCCESS",
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function updateQuestionAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const questionId = getField(formData, "questionId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const question = await prisma.quizQuestion.findFirst({
    where: { id: questionId, quizConfigId: owned.quizConfig.id },
  });
  if (!question) notFound();

  const parsed = updateQuestionSchema.safeParse({
    title: getField(formData, "title"),
    supportText: getField(formData, "supportText"),
    imageMediaId: getField(formData, "imageMediaId"),
    points: getField(formData, "points"),
    timeLimitSeconds: getField(formData, "timeLimitSeconds") || undefined,
    explanation: getField(formData, "explanation"),
    required: getField(formData, "required"),
    immediateFeedback: getField(formData, "immediateFeedback"),
  });
  if (!parsed.success) return;

  await prisma.quizQuestion.update({
    where: { id: questionId },
    data: {
      title: parsed.data.title,
      supportText: parsed.data.supportText || null,
      imageMediaId: parsed.data.imageMediaId || null,
      points: parsed.data.points,
      timeLimitSeconds: parsed.data.timeLimitSeconds ?? null,
      explanation: parsed.data.explanation || null,
      required: parsed.data.required === "on",
      immediateFeedback: parsed.data.immediateFeedback === "on",
    },
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removeQuestionAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const questionId = getField(formData, "questionId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  await prisma.quizQuestion.deleteMany({ where: { id: questionId, quizConfigId: owned.quizConfig.id } });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function moveQuestionAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const questionId = getField(formData, "questionId");
  const direction = getField(formData, "direction");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const questions = await prisma.quizQuestion.findMany({
    where: { quizConfigId: owned.quizConfig.id },
    orderBy: { order: "asc" },
  });
  const index = questions.findIndex((q) => q.id === questionId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || swapIndex < 0 || swapIndex >= questions.length) return;

  const current = questions[index];
  const swapWith = questions[swapIndex];

  await prisma.$transaction([
    prisma.quizQuestion.update({ where: { id: current.id }, data: { order: swapWith.order } }),
    prisma.quizQuestion.update({ where: { id: swapWith.id }, data: { order: current.order } }),
  ]);

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function addAnswerAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const questionId = getField(formData, "questionId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const question = await prisma.quizQuestion.findFirst({
    where: { id: questionId, quizConfigId: owned.quizConfig.id },
  });
  if (!question || question.type === "TRUE_FALSE") return;

  const parsed = addAnswerSchema.safeParse({
    text: getField(formData, "text"),
    imageMediaId: getField(formData, "imageMediaId"),
    isCorrect: getField(formData, "isCorrect"),
  });
  if (!parsed.success) return;

  const existing = await prisma.quizAnswer.findMany({
    where: { questionId },
    select: { order: true },
  });
  const nextOrder = existing.reduce((max, a) => Math.max(max, a.order), -1) + 1;

  const isCorrect = parsed.data.isCorrect === "on";

  if (isCorrect && question.type === "SINGLE_CHOICE") {
    await prisma.quizAnswer.updateMany({ where: { questionId }, data: { isCorrect: false } });
  }

  await prisma.quizAnswer.create({
    data: {
      questionId,
      order: nextOrder,
      text: parsed.data.text || null,
      imageMediaId: parsed.data.imageMediaId || null,
      isCorrect,
    },
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function toggleAnswerCorrectAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const questionId = getField(formData, "questionId");
  const answerId = getField(formData, "answerId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const question = await prisma.quizQuestion.findFirst({
    where: { id: questionId, quizConfigId: owned.quizConfig.id },
    include: { answers: true },
  });
  if (!question) notFound();

  const answer = question.answers.find((a) => a.id === answerId);
  if (!answer) notFound();

  if (question.type === "SINGLE_CHOICE" || question.type === "TRUE_FALSE") {
    await prisma.$transaction([
      prisma.quizAnswer.updateMany({ where: { questionId }, data: { isCorrect: false } }),
      prisma.quizAnswer.update({ where: { id: answerId }, data: { isCorrect: true } }),
    ]);
  } else {
    await prisma.quizAnswer.update({ where: { id: answerId }, data: { isCorrect: !answer.isCorrect } });
  }

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removeAnswerAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const questionId = getField(formData, "questionId");
  const answerId = getField(formData, "answerId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const question = await prisma.quizQuestion.findFirst({
    where: { id: questionId, quizConfigId: owned.quizConfig.id },
  });
  if (!question || question.type === "TRUE_FALSE") return;

  await prisma.quizAnswer.deleteMany({ where: { id: answerId, questionId } });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function addResultProfileAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  const parsed = resultProfileSchema.safeParse({
    minPercentage: getField(formData, "minPercentage"),
    maxPercentage: getField(formData, "maxPercentage"),
    title: getField(formData, "title"),
    description: getField(formData, "description"),
    imageMediaId: getField(formData, "imageMediaId"),
    ctaLabel: getField(formData, "ctaLabel"),
    ctaUrl: getField(formData, "ctaUrl"),
  });
  if (!parsed.success) return;

  await prisma.quizResultProfile.create({
    data: {
      quizConfigId: owned.quizConfig.id,
      minPercentage: parsed.data.minPercentage,
      maxPercentage: parsed.data.maxPercentage,
      title: parsed.data.title,
      description: parsed.data.description || null,
      imageMediaId: parsed.data.imageMediaId || null,
      ctaLabel: parsed.data.ctaLabel || null,
      ctaUrl: parsed.data.ctaUrl || null,
    },
  });

  revalidatePath(`/apps/${campaignId}/jogo`);
}

export async function removeResultProfileAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "campaign:edit");

  const campaignId = getField(formData, "campaignId");
  const profileId = getField(formData, "profileId");
  const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
  if (!owned) notFound();

  await prisma.quizResultProfile.deleteMany({ where: { id: profileId, quizConfigId: owned.quizConfig.id } });

  revalidatePath(`/apps/${campaignId}/jogo`);
}
