import { z } from "zod";
import {
  checkboxField,
  httpUrlField,
  intField,
  mediaIdField,
  optionalIntField,
  requiredTextField,
  textField,
} from "@/lib/validation/fields";

/*
 * Configuração, perguntas, respostas e perfis do Quiz Interativo (§14). Os
 * limites são os mesmos que os inputs usam em `maxLength`/`min`/`max`: o
 * browser trava antes de o servidor recusar.
 */

export const questionTypeSchema = z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "IMAGE_CHOICE"], {
  error: "Tipo: opção inválida.",
});

export type QuestionType = z.infer<typeof questionTypeSchema>;

/**
 * Só a escolha múltipla aceita várias respostas certas. O jogo público só
 * deixa escolher uma resposta nas outras (respostas com imagem incluídas), e
 * uma pergunta com duas certas ficava impossível de acertar.
 */
export function allowsSeveralCorrectAnswers(type: QuestionType): boolean {
  return type === "MULTIPLE_CHOICE";
}

export const QUIZ_CONFIG_LIMITS = {
  questionsPerParticipationMax: 1000,
  // Um dia. O mínimo é 1: com 0 o jogo terminava logo ao abrir (o vazio já
  // quer dizer "sem limite").
  timeLimitMaxSeconds: 86_400,
  penaltyPerWrongMax: 1000,
  // Com 0 ninguém podia jogar; o vazio quer dizer "ilimitadas".
  maxAttemptsMin: 1,
  maxAttemptsMax: 1000,
} as const;

export const quizConfigShape = {
  questionsPerParticipation: optionalIntField(
    "Perguntas por participação",
    1,
    QUIZ_CONFIG_LIMITS.questionsPerParticipationMax,
  ),
  randomizeQuestionOrder: checkboxField,
  randomizeAnswerOrder: checkboxField,
  totalTimeLimitSeconds: optionalIntField("Tempo total", 1, QUIZ_CONFIG_LIMITS.timeLimitMaxSeconds),
  perQuestionTimeLimitSeconds: optionalIntField("Tempo por pergunta", 1, QUIZ_CONFIG_LIMITS.timeLimitMaxSeconds),
  penaltyPerWrong: intField("Penalização por erro", 0, QUIZ_CONFIG_LIMITS.penaltyPerWrongMax),
  speedBonusEnabled: checkboxField,
  allowGoBack: checkboxField,
  showProgress: checkboxField,
  showCorrectAnswer: checkboxField,
  showExplanation: checkboxField,
  minPassPercentage: optionalIntField("Aprovação mínima", 0, 100),
  maxAttempts: optionalIntField("Máximo de tentativas", QUIZ_CONFIG_LIMITS.maxAttemptsMin, QUIZ_CONFIG_LIMITS.maxAttemptsMax),
};

export const QUIZ_QUESTION_LIMITS = {
  title: 300,
  supportText: 500,
  explanation: 1000,
  pointsMax: 1000,
  timeLimitMaxSeconds: 86_400,
} as const;

export const addQuestionShape = {
  type: questionTypeSchema,
  title: requiredTextField("Título", QUIZ_QUESTION_LIMITS.title),
};

export const addQuestionSchema = z.object(addQuestionShape);

export const quizQuestionShape = {
  title: requiredTextField("Título", QUIZ_QUESTION_LIMITS.title),
  supportText: textField("Texto de apoio", QUIZ_QUESTION_LIMITS.supportText),
  imageMediaId: mediaIdField,
  points: intField("Pontos", 0, QUIZ_QUESTION_LIMITS.pointsMax),
  timeLimitSeconds: optionalIntField("Tempo limite", 1, QUIZ_QUESTION_LIMITS.timeLimitMaxSeconds),
  explanation: textField("Explicação", QUIZ_QUESTION_LIMITS.explanation),
  required: checkboxField,
  immediateFeedback: checkboxField,
};

export const QUIZ_ANSWER_LIMITS = {
  text: 300,
} as const;

export const addAnswerSchema = z.object({
  text: textField("Resposta", QUIZ_ANSWER_LIMITS.text),
  imageMediaId: mediaIdField,
  isCorrect: checkboxField,
});

export const RESULT_PROFILE_LIMITS = {
  title: 150,
  description: 1000,
  ctaLabel: 60,
  ctaUrl: 500,
} as const;

export const resultProfileSchema = z.object({
  minPercentage: intField("Percentagem mínima", 0, 100),
  maxPercentage: intField("Percentagem máxima", 0, 100),
  title: requiredTextField("Título", RESULT_PROFILE_LIMITS.title),
  description: textField("Descrição", RESULT_PROFILE_LIMITS.description),
  imageMediaId: mediaIdField,
  ctaLabel: textField("Texto do botão", RESULT_PROFILE_LIMITS.ctaLabel),
  // Vai para um `href` no ecrã de resultado do jogo público.
  ctaUrl: httpUrlField("Link", RESULT_PROFILE_LIMITS.ctaUrl),
});

export const QUIZ_EDITOR_MESSAGES = {
  perQuestionOverTotal: "Tempo por pergunta: não pode ser superior ao tempo total.",
  totalUnderPerQuestion: "Tempo total: não pode ser inferior ao tempo por pergunta.",
  answerTextRequired: "Resposta: obrigatório.",
  answerTextOrImage: "Resposta: indique um texto ou uma imagem.",
  profileRangeOrder: "Percentagem máxima: tem de ser igual ou superior à mínima.",
  profileRangeOverlap: (title: string) => `Intervalo sobreposto com o perfil «${title}».`,
} as const;

/** Intervalos fechados, como os lê `matchResultProfile`: 0–50 e 50–100 partilham o 50. */
export function rangesOverlap(
  a: { minPercentage: number; maxPercentage: number },
  b: { minPercentage: number; maxPercentage: number },
): boolean {
  return a.minPercentage <= b.maxPercentage && b.minPercentage <= a.maxPercentage;
}
