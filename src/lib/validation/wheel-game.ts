import { z } from "zod";
import {
  checkboxField,
  dateTimeLocalField,
  intField,
  mediaIdField,
  optionalIntField,
  requiredTextField,
  textField,
} from "@/lib/validation/fields";
import { zonedDateTimeToUtc } from "@/lib/dates/timezone";

/*
 * Segmentos, prémios e códigos da Roda da Sorte. Os limites são os mesmos
 * que os inputs usam em `maxLength`/`min`/`max`: o browser trava antes de o
 * servidor recusar.
 */

export const wheelSegmentOutcomeSchema = z.enum(["WIN", "NO_WIN"], { error: "Resultado: opção inválida." });

export const WHEEL_SEGMENT_LIMITS = {
  name: 80,
  message: 300,
  code: 80,
  weightMin: 1,
  weightMax: 10_000,
  quantityMax: 1_000_000,
} as const;

export const wheelSegmentShape = {
  name: requiredTextField("Nome", WHEEL_SEGMENT_LIMITS.name),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor: use o formato #RRGGBB."),
  imageMediaId: mediaIdField,
  outcome: wheelSegmentOutcomeSchema,
  prizeId: z.string().trim().max(60, "Prémio associado: inválido."),
  weight: intField("Peso", WHEEL_SEGMENT_LIMITS.weightMin, WHEEL_SEGMENT_LIMITS.weightMax),
  totalQuantity: optionalIntField("Stock", 0, WHEEL_SEGMENT_LIMITS.quantityMax),
  periodStart: dateTimeLocalField("Início do período"),
  periodEnd: dateTimeLocalField("Fim do período"),
  message: textField("Mensagem", WHEEL_SEGMENT_LIMITS.message),
  code: textField("Código", WHEEL_SEGMENT_LIMITS.code),
  isActive: checkboxField,
};

export const PRIZE_LIMITS = {
  internalName: 150,
  publicName: 150,
  description: 1000,
  instructions: 1000,
  terms: 2000,
  quantityMax: 1_000_000,
} as const;

export const prizeShape = {
  internalName: requiredTextField("Nome interno", PRIZE_LIMITS.internalName),
  publicName: requiredTextField("Nome público", PRIZE_LIMITS.publicName),
  description: textField("Descrição", PRIZE_LIMITS.description),
  imageMediaId: mediaIdField,
  totalQuantity: optionalIntField("Quantidade total", 0, PRIZE_LIMITS.quantityMax),
  dailyLimit: optionalIntField("Limite diário", 0, PRIZE_LIMITS.quantityMax),
  instructions: textField("Instruções", PRIZE_LIMITS.instructions),
  terms: textField("Termos", PRIZE_LIMITS.terms),
  isActive: checkboxField,
  startAt: dateTimeLocalField("Início do período"),
  endAt: dateTimeLocalField("Fim do período"),
};

export const PRIZE_CODE_LIMITS = { code: 60 } as const;

export const prizeCodeShape = {
  code: requiredTextField("Código", PRIZE_CODE_LIMITS.code),
  expiresAt: dateTimeLocalField("Validade"),
};

/** Mensagens das regras que dependem de outros campos ou da base de dados (servidor e testes). */
export const WHEEL_EDITOR_MESSAGES = {
  periodOrder: "Fim do período: tem de ser depois do início.",
  duplicateCode: "Este código já existe neste prémio.",
  codeExpired: "Validade: tem de ser uma data futura.",
} as const;

export function prizeTotalBelowAwardedMessage(awarded: number, reserved = 0): string {
  if (reserved > 0) {
    return `Quantidade total: não pode ser inferior aos ${awarded + reserved} já atribuídos ou reservados (${reserved} à espera da lead).`;
  }
  return `Quantidade total: não pode ser inferior aos ${awarded} já atribuídos.`;
}

export interface ResolvedPeriod {
  /** `undefined` mantém a data gravada, `null` apaga. */
  start: Date | null | undefined;
  end: Date | null | undefined;
  /** Falso quando o fim que fica gravado não é depois do início. */
  ordered: boolean;
}

/**
 * Período de um segmento ou prémio a partir dos `<input type="datetime-local">`.
 *
 * O valor é hora "de parede" no fuso da campanha: `new Date(str)` usava o
 * fuso do processo do servidor e, em Lisboa no verão, o período ficava uma
 * hora ao lado. A ordem compara o que fica gravado de cada lado (o enviado
 * ou o atual), e só quando uma das datas foi enviada: um formulário sem o
 * período não é recusado por dados antigos.
 */
export function resolvePeriod(
  values: { start: string | undefined; end: string | undefined },
  stored: { start: Date | null; end: Date | null },
  timeZone: string,
): ResolvedPeriod {
  // Os valores já passaram por `dateTimeLocalField`: um `null` da conversão
  // não acontece, e seria tratado como "não enviado" em vez de apagar.
  const toDate = (value: string | undefined) =>
    value === undefined ? undefined : value === "" ? null : (zonedDateTimeToUtc(value, timeZone) ?? undefined);

  const start = toDate(values.start);
  const end = toDate(values.end);
  if (start === undefined && end === undefined) return { start, end, ordered: true };

  const effectiveStart = start !== undefined ? start : stored.start;
  const effectiveEnd = end !== undefined ? end : stored.end;
  const ordered = !(effectiveStart && effectiveEnd && effectiveStart.getTime() >= effectiveEnd.getTime());
  return { start, end, ordered };
}
