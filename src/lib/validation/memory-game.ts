import { z } from "zod";
import {
  checkboxField,
  intField,
  mediaIdField,
  optionalIntField,
  textField,
} from "@/lib/validation/fields";

/*
 * Configuração e pares do Jogo da Memória. Os limites são os mesmos que os
 * inputs usam em `maxLength`/`min`/`max`: o browser trava antes de o
 * servidor recusar.
 */

export const memoryPairKindSchema = z.enum(["SAME_IMAGE", "DIFFERENT_IMAGE_MATCH", "IMAGE_TEXT", "TEXT_TEXT"], {
  error: "Tipo de par: opção inválida.",
});

export type MemoryPairKind = z.infer<typeof memoryPairKindSchema>;

export const MEMORY_CONFIG_LIMITS = {
  columnsMin: 2,
  columnsMax: 8,
  cardAspectRatio: 5,
  cardGapMax: 64,
  // 0 segundos ou 0 tentativas terminavam o jogo antes da primeira carta:
  // sem limite é o campo vazio.
  timeLimitMin: 1,
  timeLimitMax: 3600,
  maxAttemptsMin: 1,
  maxAttemptsMax: 1000,
  pointsMax: 1000,
  penaltyMax: 1000,
  previewMax: 30,
  rankingMin: 1,
  rankingMax: 1000,
} as const;

export const CARD_ASPECT_RATIO_MESSAGE = "Proporção da carta: use o formato largura/altura, por exemplo 3/4.";

const L = MEMORY_CONFIG_LIMITS;

export const memoryConfigShape = {
  columns: intField("Colunas", L.columnsMin, L.columnsMax),
  randomizeOrder: checkboxField,
  // Vai para o `aspect-ratio` das cartas: "3/4" sim, "0/4" ou "alto" não.
  cardAspectRatio: z
    .string()
    .trim()
    .regex(/^\d{1,2}\/\d{1,2}$/, CARD_ASPECT_RATIO_MESSAGE)
    .refine((value) => !value.split("/").some((part) => Number(part) === 0), CARD_ASPECT_RATIO_MESSAGE),
  cardGapPx: intField("Espaçamento", 0, L.cardGapMax),
  timeLimitSeconds: optionalIntField("Tempo limite", L.timeLimitMin, L.timeLimitMax),
  maxAttempts: optionalIntField("Máximo de tentativas", L.maxAttemptsMin, L.maxAttemptsMax),
  pointsPerPair: intField("Pontos por par", 0, L.pointsMax),
  penaltyPerMistake: intField("Penalização por erro", 0, L.penaltyMax),
  speedBonusEnabled: checkboxField,
  previewSeconds: optionalIntField("Pré-visualização inicial", 0, L.previewMax),
  soundEnabled: checkboxField,
  rankingEnabled: checkboxField,
  rankingMaxEntries: optionalIntField("Limite do ranking", L.rankingMin, L.rankingMax),
  rankingAnonymize: checkboxField,
  cardBackMediaId: mediaIdField,
};

export const MEMORY_PAIR_LIMITS = { text: 200, altText: 200 } as const;

/** Mensagens dos campos que cada tipo de par exige (servidor e testes). */
export const MEMORY_PAIR_MESSAGES = {
  sameImage: "Imagem: carregue a imagem do par.",
  imageA: "Imagem da carta A: carregue uma imagem.",
  imageB: "Imagem da carta B: carregue uma imagem.",
  textA: "Texto da carta A: obrigatório.",
  textB: "Texto da carta B: obrigatório.",
} as const;

type PairField = "cardAMediaId" | "cardBMediaId" | "cardAText" | "cardBText";

/** O que cada tipo de par exige, com a mensagem que o formulário mostra. */
const REQUIRED_BY_KIND: Record<MemoryPairKind, ReadonlyArray<readonly [PairField, string]>> = {
  SAME_IMAGE: [["cardAMediaId", MEMORY_PAIR_MESSAGES.sameImage]],
  DIFFERENT_IMAGE_MATCH: [
    ["cardAMediaId", MEMORY_PAIR_MESSAGES.imageA],
    ["cardBMediaId", MEMORY_PAIR_MESSAGES.imageB],
  ],
  IMAGE_TEXT: [
    ["cardAMediaId", MEMORY_PAIR_MESSAGES.imageA],
    ["cardBText", MEMORY_PAIR_MESSAGES.textB],
  ],
  TEXT_TEXT: [
    ["cardAText", MEMORY_PAIR_MESSAGES.textA],
    ["cardBText", MEMORY_PAIR_MESSAGES.textB],
  ],
};

/**
 * Par novo. Antes todos os campos eram opcionais e um par "Texto + texto"
 * sem textos, ou de imagens sem imagem, era criado vazio no jogo.
 */
export const memoryPairSchema = z
  .object({
    kind: memoryPairKindSchema,
    cardAMediaId: mediaIdField,
    cardAText: textField("Texto da carta A", MEMORY_PAIR_LIMITS.text),
    cardAAltText: textField("Texto alternativo da carta A", MEMORY_PAIR_LIMITS.altText),
    cardBMediaId: mediaIdField,
    cardBText: textField("Texto da carta B", MEMORY_PAIR_LIMITS.text),
    cardBAltText: textField("Texto alternativo da carta B", MEMORY_PAIR_LIMITS.altText),
  })
  .superRefine((pair, ctx) => {
    // Com um tipo inválido (já recusado pelo enum), não há mais a dizer.
    if (!Object.hasOwn(REQUIRED_BY_KIND, pair.kind)) return;
    for (const [field, message] of REQUIRED_BY_KIND[pair.kind]) {
      const value = pair[field];
      if (typeof value !== "string" || value.trim() === "") {
        ctx.addIssue({ code: "custom", path: [field], message });
      }
    }
  });

export type MemoryPairInput = z.infer<typeof memoryPairSchema>;
