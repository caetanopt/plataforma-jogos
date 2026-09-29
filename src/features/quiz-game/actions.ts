"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { mediaBelongsToOrganization } from "@/server/media/ownership";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { runSerializable } from "@/lib/db/transaction-retry";
import {
  QUIZ_EDITOR_MESSAGES,
  addAnswerSchema,
  addQuestionSchema,
  allowsSeveralCorrectAnswers,
  quizConfigShape,
  quizQuestionShape,
  rangesOverlap,
  resultProfileSchema,
} from "@/lib/validation/quiz-game";
import { emptyToNull, getField, readCheckbox, readOptional } from "@/lib/forms/form-data";
import { parsePartial, rejectField } from "@/lib/forms/parse-partial";
import { fail, ok, partialResult, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";

const MEDIA_UNAVAILABLE_MESSAGE = "A imagem escolhida não está disponível. Carregue-a de novo.";
const QUESTION_GONE_MESSAGE = "A pergunta já não existe. Recarregue a página.";
const ANSWER_GONE_MESSAGE = "A resposta já não existe. Recarregue a página.";
const TRUE_FALSE_FIXED_MESSAGE = "As perguntas de verdadeiro ou falso têm sempre as mesmas duas respostas.";

async function getOwnedQuizConfig(organizationId: string, campaignId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId, type: "QUIZ" },
    include: { quizConfig: true },
  });
  return campaign?.quizConfig ? { campaign, quizConfig: campaign.quizConfig } : null;
}

// Mudam a pontuação ou quem pode jogar: ficam na auditoria (§26).
const FAIRNESS_FIELDS = ["minPassPercentage", "penaltyPerWrong", "totalTimeLimitSeconds", "maxAttempts"] as const;

export async function updateQuizConfigAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateQuizConfig", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();
    const current = owned.quizConfig;

    // Campo a campo: apagar a penalização para escrever outra já não deita
    // fora as opções marcadas no mesmo envio.
    const parse = parsePartial(quizConfigShape, {
      questionsPerParticipation: readOptional(formData, "questionsPerParticipation"),
      randomizeQuestionOrder: readCheckbox(formData, "randomizeQuestionOrder"),
      randomizeAnswerOrder: readCheckbox(formData, "randomizeAnswerOrder"),
      totalTimeLimitSeconds: readOptional(formData, "totalTimeLimitSeconds"),
      perQuestionTimeLimitSeconds: readOptional(formData, "perQuestionTimeLimitSeconds"),
      penaltyPerWrong: readOptional(formData, "penaltyPerWrong"),
      speedBonusEnabled: readCheckbox(formData, "speedBonusEnabled"),
      allowGoBack: readCheckbox(formData, "allowGoBack"),
      showProgress: readCheckbox(formData, "showProgress"),
      showCorrectAnswer: readCheckbox(formData, "showCorrectAnswer"),
      showExplanation: readCheckbox(formData, "showExplanation"),
      minPassPercentage: readOptional(formData, "minPassPercentage"),
      maxAttempts: readOptional(formData, "maxAttempts"),
    });
    const { data } = parse;

    // O tempo por pergunta cabe no tempo total, com os valores que ficam
    // gravados (os enviados e válidos, ou os atuais). Nenhum dos dois grava:
    // gravar só o total deixava a configuração incoerente.
    const total = data.totalTimeLimitSeconds !== undefined ? data.totalTimeLimitSeconds : current.totalTimeLimitSeconds;
    const perQuestion =
      data.perQuestionTimeLimitSeconds !== undefined
        ? data.perQuestionTimeLimitSeconds
        : current.perQuestionTimeLimitSeconds;
    if (total != null && perQuestion != null && perQuestion > total) {
      if (data.perQuestionTimeLimitSeconds !== undefined) {
        rejectField(parse, "perQuestionTimeLimitSeconds", QUIZ_EDITOR_MESSAGES.perQuestionOverTotal);
      }
      if (data.totalTimeLimitSeconds !== undefined && data.totalTimeLimitSeconds !== current.totalTimeLimitSeconds) {
        rejectField(parse, "totalTimeLimitSeconds", QUIZ_EDITOR_MESSAGES.totalUnderPerQuestion);
      }
    }

    const update = {
      questionsPerParticipation: data.questionsPerParticipation,
      randomizeQuestionOrder: data.randomizeQuestionOrder,
      randomizeAnswerOrder: data.randomizeAnswerOrder,
      totalTimeLimitSeconds: data.totalTimeLimitSeconds,
      perQuestionTimeLimitSeconds: data.perQuestionTimeLimitSeconds,
      penaltyPerWrong: data.penaltyPerWrong,
      speedBonusEnabled: data.speedBonusEnabled,
      allowGoBack: data.allowGoBack,
      showProgress: data.showProgress,
      showCorrectAnswer: data.showCorrectAnswer,
      showExplanation: data.showExplanation,
      minPassPercentage: data.minPassPercentage,
      maxAttempts: data.maxAttempts,
    };
    const savedSomething = Object.values(update).some((value) => value !== undefined);

    if (savedSomething) {
      await prisma.quizConfig.update({ where: { id: current.id }, data: update });

      // Só audita quando muda um campo que decide a pontuação — o formulário
      // grava a cada alteração. Compara apenas o que foi gravado: um campo
      // recusado conta com o valor que já estava.
      const after = <K extends (typeof FAIRNESS_FIELDS)[number]>(key: K) =>
        update[key] !== undefined ? update[key] : current[key];
      const fairnessChanged = FAIRNESS_FIELDS.some((key) => after(key) !== current[key]);

      if (fairnessChanged) {
        await logAudit({
          organizationId: context.organizationId,
          userId: context.userId,
          action: "UPDATE",
          entityType: "QuizConfig",
          entityId: current.id,
          result: "SUCCESS",
          metadata: {
            minPassPercentageBefore: current.minPassPercentage,
            minPassPercentageAfter: after("minPassPercentage"),
            penaltyPerWrongBefore: current.penaltyPerWrong,
            penaltyPerWrongAfter: after("penaltyPerWrong"),
            totalTimeLimitSecondsBefore: current.totalTimeLimitSeconds,
            totalTimeLimitSecondsAfter: after("totalTimeLimitSeconds"),
            maxAttemptsBefore: current.maxAttempts,
            maxAttemptsAfter: after("maxAttempts"),
          },
        });
      }

      revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    }

    return partialResult(parse.fieldErrors, savedSomething);
  });
}

export async function addQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addQuestion", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const parsed = addQuestionSchema.safeParse({
      type: getField(formData, "type"),
      title: getField(formData, "title"),
    });
    if (!parsed.success) {
      return fail("A pergunta não foi adicionada: corrija os campos assinalados.", zodFieldErrors(parsed.error));
    }
    const { type, title } = parsed.data;

    // A ordem lê-se e grava-se na mesma transação: dois envios seguidos não
    // ficam com a mesma posição.
    const question = await runSerializable(async (tx) => {
      const last = await tx.quizQuestion.findFirst({
        where: { quizConfigId: owned.quizConfig.id },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      return tx.quizQuestion.create({
        data: {
          quizConfigId: owned.quizConfig.id,
          order: (last?.order ?? -1) + 1,
          type,
          title,
          answers:
            type === "TRUE_FALSE"
              ? {
                  create: [
                    { order: 0, text: "Verdadeiro", isCorrect: true },
                    { order: 1, text: "Falso", isCorrect: false },
                  ],
                }
              : undefined,
        },
      });
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "QuizQuestion",
      entityId: question.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Pergunta adicionada.");
  });
}

export async function updateQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateQuestion", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const questionId = readOptional(formData, "questionId") ?? "";
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const question = await prisma.quizQuestion.findFirst({
      where: { id: questionId, quizConfigId: owned.quizConfig.id },
      select: { id: true },
    });
    if (!question) notFound();

    // Só os campos que o formulário enviou. Antes a imagem, que o formulário
    // de edição não tinha, era apagada a cada gravação.
    const parse = parsePartial(quizQuestionShape, {
      title: readOptional(formData, "title"),
      supportText: readOptional(formData, "supportText"),
      imageMediaId: readOptional(formData, "imageMediaId"),
      points: readOptional(formData, "points"),
      timeLimitSeconds: readOptional(formData, "timeLimitSeconds"),
      explanation: readOptional(formData, "explanation"),
      required: readCheckbox(formData, "required"),
      immediateFeedback: readCheckbox(formData, "immediateFeedback"),
    });
    // Tudo ou nada: o formulário tem botão de gravar, e uma pergunta gravada
    // a meias (título novo, pontos antigos) não é o que o editor confirmou.
    if (Object.keys(parse.fieldErrors).length > 0) {
      return fail("A pergunta não foi guardada: corrija os campos assinalados.", parse.fieldErrors);
    }
    const { data } = parse;

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    const update = {
      title: data.title,
      supportText: emptyToNull(data.supportText),
      imageMediaId: emptyToNull(data.imageMediaId),
      points: data.points,
      timeLimitSeconds: data.timeLimitSeconds,
      explanation: emptyToNull(data.explanation),
      required: data.required,
      immediateFeedback: data.immediateFeedback,
    };
    if (!Object.values(update).some((value) => value !== undefined)) return ok();

    await prisma.quizQuestion.update({ where: { id: question.id }, data: update });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "QuizQuestion",
      entityId: question.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Pergunta guardada.");
  });
}

export async function removeQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeQuestion", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const questionId = readOptional(formData, "questionId") ?? "";
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const deleted = await prisma.quizQuestion.deleteMany({
      where: { id: questionId, quizConfigId: owned.quizConfig.id },
    });
    if (deleted.count === 0) return fail(QUESTION_GONE_MESSAGE);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "QuizQuestion",
      entityId: questionId,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}

export async function moveQuestionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("moveQuestion", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const questionId = readOptional(formData, "questionId") ?? "";
    const direction = readOptional(formData, "direction");
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    if (direction !== "up" && direction !== "down") return fail("Indique se a pergunta sobe ou desce.");

    const questions = await prisma.quizQuestion.findMany({
      where: { quizConfigId: owned.quizConfig.id },
      orderBy: { order: "asc" },
      select: { id: true, order: true },
    });
    const index = questions.findIndex((q) => q.id === questionId);
    if (index === -1) return fail(QUESTION_GONE_MESSAGE);
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0) return fail("A pergunta já é a primeira.");
    if (swapIndex >= questions.length) return fail("A pergunta já é a última.");

    const current = questions[index];
    const swapWith = questions[swapIndex];

    await prisma.$transaction([
      prisma.quizQuestion.update({ where: { id: current.id }, data: { order: swapWith.order } }),
      prisma.quizQuestion.update({ where: { id: swapWith.id }, data: { order: current.order } }),
    ]);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "QuizQuestion",
      entityId: current.id,
      result: "SUCCESS",
      metadata: { action: "reorder", swappedWith: swapWith.id },
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}

export async function addAnswerAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addAnswer", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = getField(formData, "campaignId");
    const questionId = getField(formData, "questionId");
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const question = await prisma.quizQuestion.findFirst({
      where: { id: questionId, quizConfigId: owned.quizConfig.id },
      select: { id: true, type: true },
    });
    if (!question) notFound();
    if (question.type === "TRUE_FALSE") return fail(TRUE_FALSE_FIXED_MESSAGE);

    const parsed = addAnswerSchema.safeParse({
      text: getField(formData, "text"),
      // Só as respostas com imagem levam imagem: nas outras o jogo não a mostra.
      imageMediaId: question.type === "IMAGE_CHOICE" ? getField(formData, "imageMediaId") : "",
      isCorrect: readCheckbox(formData, "isCorrect") ?? false,
    });
    const invalid = "A resposta não foi adicionada: corrija os campos assinalados.";
    if (!parsed.success) return fail(invalid, zodFieldErrors(parsed.error));
    const { text, imageMediaId, isCorrect } = parsed.data;

    if (!text && !imageMediaId) {
      return fail(invalid, {
        text:
          question.type === "IMAGE_CHOICE"
            ? QUIZ_EDITOR_MESSAGES.answerTextOrImage
            : QUIZ_EDITOR_MESSAGES.answerTextRequired,
      });
    }

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    // Desmarcar a certa anterior e criar a nova na mesma transação: uma falha
    // a meio deixava a pergunta sem resposta certa.
    const answer = await runSerializable(async (tx) => {
      if (isCorrect && !allowsSeveralCorrectAnswers(question.type)) {
        await tx.quizAnswer.updateMany({ where: { questionId: question.id }, data: { isCorrect: false } });
      }
      const last = await tx.quizAnswer.findFirst({
        where: { questionId: question.id },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      return tx.quizAnswer.create({
        data: {
          questionId: question.id,
          order: (last?.order ?? -1) + 1,
          text: text || null,
          imageMediaId: imageMediaId || null,
          isCorrect,
        },
      });
    });

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "QuizAnswer",
      entityId: answer.id,
      result: "SUCCESS",
      metadata: { questionId: question.id, isCorrect },
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Resposta adicionada.");
  });
}

export async function toggleAnswerCorrectAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("toggleAnswerCorrect", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const questionId = readOptional(formData, "questionId") ?? "";
    const answerId = readOptional(formData, "answerId") ?? "";
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const question = await prisma.quizQuestion.findFirst({
      where: { id: questionId, quizConfigId: owned.quizConfig.id },
      include: { answers: true },
    });
    if (!question) notFound();

    const answer = question.answers.find((a) => a.id === answerId);
    if (!answer) notFound();

    // Com uma só resposta certa (verdadeiro ou falso incluído), marcar uma
    // desmarca as outras; na escolha múltipla cada uma alterna sozinha.
    if (allowsSeveralCorrectAnswers(question.type)) {
      await prisma.quizAnswer.update({ where: { id: answer.id }, data: { isCorrect: !answer.isCorrect } });
    } else {
      await runSerializable(async (tx) => {
        await tx.quizAnswer.updateMany({
          where: { questionId: question.id, id: { not: answer.id } },
          data: { isCorrect: false },
        });
        await tx.quizAnswer.update({ where: { id: answer.id }, data: { isCorrect: true } });
      });
    }

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "QuizAnswer",
      entityId: answer.id,
      result: "SUCCESS",
      metadata: { questionId: question.id, isCorrectBefore: answer.isCorrect },
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}

export async function removeAnswerAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeAnswer", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const questionId = readOptional(formData, "questionId") ?? "";
    const answerId = readOptional(formData, "answerId") ?? "";
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const question = await prisma.quizQuestion.findFirst({
      where: { id: questionId, quizConfigId: owned.quizConfig.id },
      select: { id: true, type: true },
    });
    if (!question) notFound();
    if (question.type === "TRUE_FALSE") return fail(TRUE_FALSE_FIXED_MESSAGE);

    const deleted = await prisma.quizAnswer.deleteMany({ where: { id: answerId, questionId: question.id } });
    if (deleted.count === 0) return fail(ANSWER_GONE_MESSAGE);

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "QuizAnswer",
      entityId: answerId,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}

export async function addResultProfileAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("addResultProfile", async () => {
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
    const invalid = "O perfil não foi adicionado: corrija os campos assinalados.";
    if (!parsed.success) return fail(invalid, zodFieldErrors(parsed.error));
    const data = parsed.data;

    if (data.minPercentage > data.maxPercentage) {
      return fail(invalid, { maxPercentage: QUIZ_EDITOR_MESSAGES.profileRangeOrder });
    }

    // Só media da própria organização (ver mediaBelongsToOrganization).
    if (!(await mediaBelongsToOrganization(context.organizationId, [data.imageMediaId]))) {
      return fail(MEDIA_UNAVAILABLE_MESSAGE);
    }

    // Com intervalos sobrepostos, a mesma percentagem cabia em dois perfis e o
    // jogo mostrava o primeiro que encontrasse. A verificação e a criação
    // correm na mesma transação serializável: dois envios ao mesmo tempo não
    // passam ambos.
    const outcome = await runSerializable(async (tx) => {
      const existing = await tx.quizResultProfile.findMany({
        where: { quizConfigId: owned.quizConfig.id },
        orderBy: { minPercentage: "asc" },
        select: { title: true, minPercentage: true, maxPercentage: true },
      });
      const overlapping = existing.find((profile) => rangesOverlap(profile, data));
      if (overlapping) return { kind: "overlap" as const, title: overlapping.title };

      const profile = await tx.quizResultProfile.create({
        data: {
          quizConfigId: owned.quizConfig.id,
          minPercentage: data.minPercentage,
          maxPercentage: data.maxPercentage,
          title: data.title,
          description: data.description || null,
          imageMediaId: data.imageMediaId || null,
          ctaLabel: data.ctaLabel || null,
          ctaUrl: data.ctaUrl || null,
        },
        select: { id: true },
      });
      return { kind: "created" as const, id: profile.id };
    });

    if (outcome.kind === "overlap") {
      return fail(invalid, { minPercentage: QUIZ_EDITOR_MESSAGES.profileRangeOverlap(outcome.title) });
    }

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "CREATE",
      entityType: "QuizResultProfile",
      entityId: outcome.id,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok("Perfil adicionado.");
  });
}

export async function removeResultProfileAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("removeResultProfile", async () => {
    const context = await requireOrgContext();
    assertCan(context, "campaign:edit");

    const campaignId = readOptional(formData, "campaignId") ?? "";
    const profileId = readOptional(formData, "profileId") ?? "";
    const owned = await getOwnedQuizConfig(context.organizationId, campaignId);
    if (!owned) notFound();

    const deleted = await prisma.quizResultProfile.deleteMany({
      where: { id: profileId, quizConfigId: owned.quizConfig.id },
    });
    if (deleted.count === 0) return fail("O perfil já não existe. Recarregue a página.");

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "DELETE",
      entityType: "QuizResultProfile",
      entityId: profileId,
      result: "SUCCESS",
    });

    revalidatePath(`/apps/${owned.campaign.id}/jogo`);
    return ok();
  });
}
