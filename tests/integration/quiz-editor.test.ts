import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { MembershipRole } from "@/generated/prisma/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Editor do Quiz (passo 5a): as ações respondem com erro em vez de sair em
 * silêncio, e os formulários de edição só mexem nos campos que enviam.
 *
 * As ações correm a sério contra a base de dados; só se substitui a sessão e
 * o cache do Next, que dependem de um pedido HTTP.
 */

const session = vi.hoisted(() => ({ current: null as OrgContext | null }));

vi.mock("@/server/auth/session", () => ({
  requireOrgContext: async () => {
    if (!session.current) throw new Error("Sem sessão de teste.");
    return session.current;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { IDLE } = await import("@/lib/forms/action-result");
const {
  addAnswerAction,
  addQuestionAction,
  addResultProfileAction,
  moveQuestionAction,
  removeAnswerAction,
  toggleAnswerCorrectAction,
  updateQuestionAction,
  updateQuizConfigAction,
} = await import("@/features/quiz-game/actions");

const NOT_FOUND = { digest: expect.stringContaining("404") };

type Entries = Array<[string, string]>;

function form(entries: Entries): FormData {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

/** Como o CheckboxField: a sentinela vai sempre, o "on" só marcada. */
function checkbox(name: string, checked: boolean): Entries {
  return checked ? [[name, ""], [name, "on"]] : [[name, ""]];
}

async function createOrgWithQuiz(label: string, role: MembershipRole = "ORG_ADMIN") {
  const suffix = `${label}-${randomUUID().slice(0, 8)}`;
  const organization = await prisma.organization.create({
    data: { name: `Quiz ${suffix}`, slug: `quiz-${suffix}` },
  });
  const user = await prisma.user.create({
    data: { name: "Teste", email: `quiz-${suffix}@example.com`, passwordHash: "test-hash" },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Quiz", slug: `quiz-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: "QUIZ",
      internalName: `Quiz ${suffix}`,
      ownerId: user.id,
      slug: `quiz-${suffix}`,
      quizConfig: { create: { penaltyPerWrong: 5, totalTimeLimitSeconds: 120, perQuestionTimeLimitSeconds: 20 } },
    },
    include: { quizConfig: true },
  });
  const quizConfigId = campaign.quizConfig!.id;
  const media = await prisma.mediaAsset.create({
    data: {
      organizationId: organization.id,
      uploadedById: user.id,
      kind: "IMAGE",
      storageKey: `org/${organization.id}/${suffix}.png`,
      url: `https://cdn.test/${suffix}.png`,
      mimeType: "image/png",
      sizeBytes: 100,
    },
  });

  const context: OrgContext = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    isSuperAdmin: false,
    organizationId: organization.id,
    membership,
  };

  const cleanup = async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.quizResultProfile.deleteMany({ where: { quizConfigId } });
    await prisma.quizAnswer.deleteMany({ where: { question: { quizConfigId } } });
    await prisma.quizQuestion.deleteMany({ where: { quizConfigId } });
    await prisma.quizConfig.deleteMany({ where: { campaignId: campaign.id } });
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.mediaAsset.deleteMany({ where: { organizationId: organization.id } });
    await prisma.workspace.delete({ where: { id: workspace.id } });
    await prisma.membership.delete({ where: { id: membership.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  };

  return { campaignId: campaign.id, quizConfigId, mediaId: media.id, context, cleanup };
}

type Fixture = Awaited<ReturnType<typeof createOrgWithQuiz>>;

let quiz: Fixture;
const extraFixtures: Fixture[] = [];

beforeEach(async () => {
  quiz = await createOrgWithQuiz("a");
  session.current = quiz.context;
});

afterEach(async () => {
  session.current = null;
  await quiz.cleanup();
  while (extraFixtures.length > 0) await extraFixtures.pop()!.cleanup();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createQuestion(data: { type?: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "IMAGE_CHOICE" } = {}) {
  return prisma.quizQuestion.create({
    data: {
      quizConfigId: quiz.quizConfigId,
      order: await prisma.quizQuestion.count({ where: { quizConfigId: quiz.quizConfigId } }),
      type: data.type ?? "SINGLE_CHOICE",
      title: "Qual é a capital?",
      supportText: "Pense bem",
      imageMediaId: quiz.mediaId,
      points: 25,
      timeLimitSeconds: 30,
      explanation: "Lisboa é a capital.",
      required: true,
      immediateFeedback: true,
    },
  });
}

/** Os campos que o formulário "Editar pergunta" envia, na mesma forma. */
function questionEditForm(questionId: string, overrides: Record<string, string> = {}, withImage = true): FormData {
  const values = {
    title: "Qual é a capital de Portugal?",
    supportText: "Pense bem",
    imageMediaId: quiz.mediaId,
    points: "40",
    timeLimitSeconds: "30",
    explanation: "Lisboa é a capital.",
    ...overrides,
  };
  const entries: Entries = [
    ["campaignId", quiz.campaignId],
    ["questionId", questionId],
    ["title", values.title],
    ["supportText", values.supportText],
    ["points", values.points],
    ["timeLimitSeconds", values.timeLimitSeconds],
    ["explanation", values.explanation],
    ...checkbox("required", true),
    ...checkbox("immediateFeedback", false),
  ];
  if (withImage) entries.push(["imageMediaId", values.imageMediaId]);
  return form(entries);
}

/** Os campos que o formulário de configuração (gravação automática) envia. */
function configForm(overrides: Record<string, string> = {}, checks: Record<string, boolean> = {}): FormData {
  const values = {
    questionsPerParticipation: "",
    totalTimeLimitSeconds: "120",
    perQuestionTimeLimitSeconds: "20",
    penaltyPerWrong: "5",
    minPassPercentage: "",
    maxAttempts: "",
    ...overrides,
  };
  const flags = {
    randomizeQuestionOrder: false,
    randomizeAnswerOrder: false,
    speedBonusEnabled: false,
    allowGoBack: true,
    showProgress: true,
    showCorrectAnswer: true,
    showExplanation: true,
    ...checks,
  };
  return form([
    ["campaignId", quiz.campaignId],
    ...Object.entries(values),
    ...Object.entries(flags).flatMap(([name, checked]) => checkbox(name, checked)),
  ]);
}

describe("updateQuestionAction", () => {
  it("grava o formulário de edição e mantém a imagem e o resto da pergunta", async () => {
    const question = await createQuestion();

    const result = await updateQuestionAction(IDLE, questionEditForm(question.id));
    expect(result).toMatchObject({ status: "success" });

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved).toMatchObject({
      title: "Qual é a capital de Portugal?",
      points: 40,
      supportText: "Pense bem",
      imageMediaId: quiz.mediaId,
      timeLimitSeconds: 30,
      explanation: "Lisboa é a capital.",
      required: true,
      immediateFeedback: false,
      type: "SINGLE_CHOICE",
      order: question.order,
    });
  });

  it("um formulário sem o campo da imagem não a apaga", async () => {
    const question = await createQuestion();

    const result = await updateQuestionAction(IDLE, questionEditForm(question.id, { title: "Novo título" }, false));
    expect(result).toMatchObject({ status: "success" });

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.title).toBe("Novo título");
    expect(saved.imageMediaId).toBe(quiz.mediaId);
  });

  it("só os campos enviados mudam", async () => {
    const question = await createQuestion();

    const result = await updateQuestionAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["questionId", question.id],
        ["points", "7"],
      ]),
    );
    expect(result).toMatchObject({ status: "success" });

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved).toMatchObject({
      title: question.title,
      supportText: question.supportText,
      imageMediaId: quiz.mediaId,
      points: 7,
      timeLimitSeconds: 30,
      explanation: question.explanation,
      required: true,
      immediateFeedback: true,
    });
  });

  it("Remover a imagem (campo vazio) apaga-a, e tempo vazio fica sem limite", async () => {
    const question = await createQuestion();

    await updateQuestionAction(IDLE, questionEditForm(question.id, { imageMediaId: "", timeLimitSeconds: "" }));

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.imageMediaId).toBeNull();
    expect(saved.timeLimitSeconds).toBeNull();
  });

  it("recusa um valor inválido com o erro no campo e não grava nada", async () => {
    const question = await createQuestion();

    const result = await updateQuestionAction(
      IDLE,
      questionEditForm(question.id, { title: "Título que não pode ficar", points: "abc" }),
    );
    expect(result).toMatchObject({ status: "error", fieldErrors: { points: "Pontos: tem de ser um número." } });

    const emptyTitle = await updateQuestionAction(IDLE, questionEditForm(question.id, { title: "  " }));
    expect(emptyTitle).toMatchObject({ status: "error", fieldErrors: { title: "Título: obrigatório." } });

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.title).toBe(question.title);
    expect(saved.points).toBe(25);
  });

  it("recusa uma imagem de outra organização", async () => {
    const other = await createOrgWithQuiz("b");
    extraFixtures.push(other);
    const question = await createQuestion();

    const result = await updateQuestionAction(IDLE, questionEditForm(question.id, { imageMediaId: other.mediaId }));
    expect(result).toMatchObject({
      status: "error",
      message: "A imagem escolhida não está disponível. Carregue-a de novo.",
    });

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.imageMediaId).toBe(quiz.mediaId);
  });

  it("não edita a pergunta de outra organização", async () => {
    const question = await createQuestion();
    const other = await createOrgWithQuiz("b");
    extraFixtures.push(other);
    session.current = other.context;

    await expect(updateQuestionAction(IDLE, questionEditForm(question.id))).rejects.toMatchObject(NOT_FOUND);

    const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
    expect(saved.title).toBe(question.title);
  });

  it("um visualizador recebe um erro de permissão e nada muda", async () => {
    const question = await createQuestion();
    const viewer = await prisma.user.create({
      data: { name: "Leitor", email: `quiz-viewer-${randomUUID().slice(0, 8)}@example.com`, passwordHash: "x" },
    });
    const membership = await prisma.membership.create({
      data: { userId: viewer.id, organizationId: quiz.context.organizationId, role: "VIEWER" },
    });
    try {
      session.current = { ...quiz.context, userId: viewer.id, membership };
      const result = await updateQuestionAction(IDLE, questionEditForm(question.id));
      expect(result).toMatchObject({ status: "error", message: "Não tem permissão para fazer esta alteração." });

      const saved = await prisma.quizQuestion.findUniqueOrThrow({ where: { id: question.id } });
      expect(saved.title).toBe(question.title);
    } finally {
      await prisma.membership.delete({ where: { id: membership.id } });
      await prisma.user.delete({ where: { id: viewer.id } });
    }
  });
});

describe("addQuestionAction e moveQuestionAction", () => {
  it("título vazio devolve o erro no campo title", async () => {
    const result = await addQuestionAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["type", "SINGLE_CHOICE"],
        ["title", ""],
      ]),
    );
    expect(result).toMatchObject({ status: "error", fieldErrors: { title: "Título: obrigatório." } });
    expect(await prisma.quizQuestion.count({ where: { quizConfigId: quiz.quizConfigId } })).toBe(0);
  });

  it("verdadeiro ou falso nasce com as duas respostas e ordens seguidas", async () => {
    for (const title of ["Primeira", "Segunda"]) {
      const result = await addQuestionAction(
        IDLE,
        form([
          ["campaignId", quiz.campaignId],
          ["type", "TRUE_FALSE"],
          ["title", title],
        ]),
      );
      expect(result).toMatchObject({ status: "success" });
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { quizConfigId: quiz.quizConfigId },
      include: { answers: { orderBy: { order: "asc" } } },
      orderBy: { order: "asc" },
    });
    expect(questions.map((q) => [q.title, q.order])).toEqual([
      ["Primeira", 0],
      ["Segunda", 1],
    ]);
    expect(questions[0].answers.map((a) => [a.text, a.isCorrect])).toEqual([
      ["Verdadeiro", true],
      ["Falso", false],
    ]);
  });

  it("mover a primeira para cima responde com erro em vez de nada", async () => {
    const first = await createQuestion();
    await createQuestion();

    const result = await moveQuestionAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["questionId", first.id],
        ["direction", "up"],
      ]),
    );
    expect(result).toMatchObject({ status: "error", message: "A pergunta já é a primeira." });

    const moved = await moveQuestionAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["questionId", first.id],
        ["direction", "down"],
      ]),
    );
    expect(moved).toMatchObject({ status: "success" });
    expect((await prisma.quizQuestion.findUniqueOrThrow({ where: { id: first.id } })).order).toBe(1);
  });
});

describe("respostas", () => {
  async function trueFalseQuestion() {
    await addQuestionAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["type", "TRUE_FALSE"],
        ["title", "O céu é verde?"],
      ]),
    );
    return prisma.quizQuestion.findFirstOrThrow({
      where: { quizConfigId: quiz.quizConfigId, type: "TRUE_FALSE" },
      include: { answers: true },
    });
  }

  function toggleForm(questionId: string, answerId: string): FormData {
    return form([
      ["campaignId", quiz.campaignId],
      ["questionId", questionId],
      ["answerId", answerId],
    ]);
  }

  it("verdadeiro ou falso: marcar «Falso» torna-a a única correta", async () => {
    const question = await trueFalseQuestion();
    const falso = question.answers.find((a) => a.text === "Falso")!;

    expect(await toggleAnswerCorrectAction(IDLE, toggleForm(question.id, falso.id))).toMatchObject({
      status: "success",
    });

    const answers = await prisma.quizAnswer.findMany({ where: { questionId: question.id } });
    expect(Object.fromEntries(answers.map((a) => [a.text, a.isCorrect]))).toEqual({
      Verdadeiro: false,
      Falso: true,
    });
  });

  it("verdadeiro ou falso: as respostas não se removem nem se acrescentam", async () => {
    const question = await trueFalseQuestion();

    const removed = await removeAnswerAction(IDLE, toggleForm(question.id, question.answers[0].id));
    expect(removed).toMatchObject({ status: "error" });
    const added = await addAnswerAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["questionId", question.id],
        ["text", "Talvez"],
        ...checkbox("isCorrect", false),
      ]),
    );
    expect(added).toMatchObject({ status: "error" });
    expect(await prisma.quizAnswer.count({ where: { questionId: question.id } })).toBe(2);
  });

  it("respostas com imagem: sem texto nem imagem é recusada no campo text", async () => {
    const question = await createQuestion({ type: "IMAGE_CHOICE" });
    const answerForm = (entries: Entries) =>
      form([["campaignId", quiz.campaignId], ["questionId", question.id], ...entries, ...checkbox("isCorrect", false)]);

    const empty = await addAnswerAction(IDLE, answerForm([["text", ""], ["imageMediaId", ""]]));
    expect(empty).toMatchObject({
      status: "error",
      fieldErrors: { text: "Resposta: indique um texto ou uma imagem." },
    });
    expect(await prisma.quizAnswer.count({ where: { questionId: question.id } })).toBe(0);

    const imageOnly = await addAnswerAction(IDLE, answerForm([["text", ""], ["imageMediaId", quiz.mediaId]]));
    expect(imageOnly).toMatchObject({ status: "success" });
    const created = await prisma.quizAnswer.findFirstOrThrow({ where: { questionId: question.id } });
    expect(created).toMatchObject({ text: null, imageMediaId: quiz.mediaId });
  });

  it("escolha única: uma nova resposta certa desmarca a anterior", async () => {
    const question = await createQuestion();
    const add = (text: string, correct: boolean) =>
      addAnswerAction(
        IDLE,
        form([
          ["campaignId", quiz.campaignId],
          ["questionId", question.id],
          ["text", text],
          ...checkbox("isCorrect", correct),
        ]),
      );

    expect(await add("Porto", true)).toMatchObject({ status: "success" });
    expect(await add("Lisboa", true)).toMatchObject({ status: "success" });
    expect(await add("Faro", false)).toMatchObject({ status: "success" });

    const answers = await prisma.quizAnswer.findMany({ where: { questionId: question.id }, orderBy: { order: "asc" } });
    expect(answers.map((a) => [a.text, a.order, a.isCorrect])).toEqual([
      ["Porto", 0, false],
      ["Lisboa", 1, true],
      ["Faro", 2, false],
    ]);
  });

  it("texto acima do limite devolve o erro no campo text", async () => {
    const question = await createQuestion();
    const result = await addAnswerAction(
      IDLE,
      form([
        ["campaignId", quiz.campaignId],
        ["questionId", question.id],
        ["text", "x".repeat(301)],
        ...checkbox("isCorrect", false),
      ]),
    );
    expect(result).toMatchObject({ status: "error", fieldErrors: { text: "Resposta: máximo 300 caracteres." } });
  });
});

describe("addResultProfileAction", () => {
  function profileForm(fields: Record<string, string>): FormData {
    const values = {
      minPercentage: "0",
      maxPercentage: "49",
      title: "Principiante",
      description: "",
      imageMediaId: "",
      ctaLabel: "",
      ctaUrl: "",
      ...fields,
    };
    return form([["campaignId", quiz.campaignId], ...Object.entries(values)]);
  }

  it("mínimo acima do máximo é recusado em maxPercentage", async () => {
    const result = await addResultProfileAction(IDLE, profileForm({ minPercentage: "60", maxPercentage: "40" }));
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { maxPercentage: "Percentagem máxima: tem de ser igual ou superior à mínima." },
    });
    expect(await prisma.quizResultProfile.count({ where: { quizConfigId: quiz.quizConfigId } })).toBe(0);
  });

  it("um intervalo sobreposto é recusado em minPercentage com o nome do outro perfil", async () => {
    expect(await addResultProfileAction(IDLE, profileForm({}))).toMatchObject({ status: "success" });

    const overlap = await addResultProfileAction(
      IDLE,
      profileForm({ minPercentage: "49", maxPercentage: "100", title: "Especialista" }),
    );
    expect(overlap).toMatchObject({
      status: "error",
      fieldErrors: { minPercentage: "Intervalo sobreposto com o perfil «Principiante»." },
    });

    const adjacent = await addResultProfileAction(
      IDLE,
      profileForm({ minPercentage: "50", maxPercentage: "100", title: "Especialista", imageMediaId: quiz.mediaId }),
    );
    expect(adjacent).toMatchObject({ status: "success" });

    const profiles = await prisma.quizResultProfile.findMany({
      where: { quizConfigId: quiz.quizConfigId },
      orderBy: { minPercentage: "asc" },
    });
    expect(profiles.map((p) => [p.title, p.minPercentage, p.maxPercentage, p.imageMediaId])).toEqual([
      ["Principiante", 0, 49, null],
      ["Especialista", 50, 100, quiz.mediaId],
    ]);
  });

  it("o link do botão só aceita http(s)", async () => {
    const result = await addResultProfileAction(
      IDLE,
      profileForm({ ctaLabel: "Ver", ctaUrl: "javascript:alert(1)" }),
    );
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { ctaUrl: "Link: tem de começar por https:// ou http://." },
    });
  });
});

describe("updateQuizConfigAction (gravação automática)", () => {
  it("penalização inválida não impede gravar a checkbox do mesmo envio", async () => {
    const result = await updateQuizConfigAction(
      IDLE,
      configForm({ penaltyPerWrong: "" }, { speedBonusEnabled: true, allowGoBack: false }),
    );
    expect(result).toMatchObject({
      status: "error",
      message: "Algumas alterações não foram guardadas.",
      fieldErrors: { penaltyPerWrong: "Penalização por erro: obrigatório." },
    });

    const saved = await prisma.quizConfig.findUniqueOrThrow({ where: { id: quiz.quizConfigId } });
    expect(saved).toMatchObject({
      speedBonusEnabled: true,
      allowGoBack: false,
      penaltyPerWrong: 5,
      totalTimeLimitSeconds: 120,
      perQuestionTimeLimitSeconds: 20,
    });
  });

  it("penalização acima do máximo é recusada", async () => {
    const result = await updateQuizConfigAction(IDLE, configForm({ penaltyPerWrong: "1001" }));
    expect(result).toMatchObject({
      status: "error",
      fieldErrors: { penaltyPerWrong: "Penalização por erro: máximo 1000." },
    });
  });

  it("campos opcionais vazios passam a sem limite; mais perguntas do que as existentes não é erro", async () => {
    const result = await updateQuizConfigAction(
      IDLE,
      configForm({ totalTimeLimitSeconds: "", perQuestionTimeLimitSeconds: "", questionsPerParticipation: "50" }),
    );
    expect(result).toMatchObject({ status: "success" });

    const saved = await prisma.quizConfig.findUniqueOrThrow({ where: { id: quiz.quizConfigId } });
    expect(saved).toMatchObject({
      totalTimeLimitSeconds: null,
      perQuestionTimeLimitSeconds: null,
      questionsPerParticipation: 50,
    });
  });

  it("tempo por pergunta acima do total é recusado e os tempos não mudam", async () => {
    const perQuestion = await updateQuizConfigAction(IDLE, configForm({ perQuestionTimeLimitSeconds: "200" }));
    expect(perQuestion).toMatchObject({
      status: "error",
      fieldErrors: { perQuestionTimeLimitSeconds: "Tempo por pergunta: não pode ser superior ao tempo total." },
    });

    // Baixar o total para menos do que o tempo por pergunta gravado também.
    const total = await updateQuizConfigAction(IDLE, configForm({ totalTimeLimitSeconds: "10" }));
    expect(total).toMatchObject({ status: "error" });
    expect(total.status === "error" && Object.keys(total.fieldErrors).sort()).toEqual([
      "perQuestionTimeLimitSeconds",
      "totalTimeLimitSeconds",
    ]);

    const saved = await prisma.quizConfig.findUniqueOrThrow({ where: { id: quiz.quizConfigId } });
    expect(saved).toMatchObject({ totalTimeLimitSeconds: 120, perQuestionTimeLimitSeconds: 20 });
  });

  it("audita só quando muda um campo da pontuação que foi gravado", async () => {
    const audits = () =>
      prisma.auditLog.count({ where: { entityType: "QuizConfig", entityId: quiz.quizConfigId } });

    await updateQuizConfigAction(IDLE, configForm({}, { showProgress: false }));
    expect(await audits()).toBe(0);

    // A penalização recusada não conta como alteração.
    await updateQuizConfigAction(IDLE, configForm({ penaltyPerWrong: "abc" }));
    expect(await audits()).toBe(0);

    await updateQuizConfigAction(IDLE, configForm({ penaltyPerWrong: "8" }));
    expect(await audits()).toBe(1);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "QuizConfig", entityId: quiz.quizConfigId },
    });
    expect(entry.metadata).toMatchObject({ penaltyPerWrongBefore: 5, penaltyPerWrongAfter: 8 });
  });

  it("sem campos no envio não grava nem audita", async () => {
    const result = await updateQuizConfigAction(IDLE, form([["campaignId", quiz.campaignId]]));
    expect(result).toMatchObject({ status: "success" });
    const saved = await prisma.quizConfig.findUniqueOrThrow({ where: { id: quiz.quizConfigId } });
    expect(saved.penaltyPerWrong).toBe(5);
  });
});
