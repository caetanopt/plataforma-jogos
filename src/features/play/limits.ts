import type { DedupStrategy, ParticipationLimitType, Prisma } from "@/generated/prisma/client";

export interface ParticipationLimitCheckInput {
  organizationId: string;
  campaignId: string;
  limitType: ParticipationLimitType;
  customMax: number | null;
  dedupStrategies: DedupStrategy[];
  cookieId?: string | null;
  email?: string | null;
  phone?: string | null;
  ip?: string | null;
  sessionId?: string | null;
  now: Date;
}

/**
 * Valida o limite de participação (secção 16) e o controlo de duplicados
 * (secção 11). O cookie do visitante é sempre considerado (é a única forma
 * de aplicar limites a visitantes anónimos); e-mail, telefone, IP e sessão
 * só entram se o admin ativou essa estratégia. As estratégias "Código" e
 * "Combinação de campos" ficam por implementar — não têm UI de configuração
 * ainda e ficam documentadas como trabalho futuro.
 *
 * Recebe explicitamente o cliente Prisma (`db`) para poder correr dentro da
 * mesma transação serializável que cria a participação — ler a contagem
 * fora dessa transação permitiria a dois pedidos concorrentes do mesmo
 * visitante lerem ambos "abaixo do limite" antes de qualquer um criar a
 * sua participação.
 */
export async function checkParticipationAllowed(
  db: Prisma.TransactionClient,
  input: ParticipationLimitCheckInput,
): Promise<boolean> {
  if (input.limitType === "UNLIMITED") return true;

  const windowStart =
    input.limitType === "ONE_PER_DAY"
      ? new Date(input.now.getTime() - 24 * 60 * 60 * 1000)
      : input.limitType === "ONE_PER_HOUR"
        ? new Date(input.now.getTime() - 60 * 60 * 1000)
        : new Date(0);

  const maxAllowed = input.limitType === "CUSTOM_MAX" ? Math.max(1, input.customMax ?? 1) : 1;

  const participantIds = new Set<string>();
  if (input.cookieId) {
    const participant = await db.participant.findFirst({
      where: { organizationId: input.organizationId, cookieId: input.cookieId },
      select: { id: true },
    });
    if (participant) participantIds.add(participant.id);
  }
  if (input.dedupStrategies.includes("EMAIL") && input.email) {
    const participant = await db.participant.findFirst({
      where: { organizationId: input.organizationId, email: input.email },
      select: { id: true },
    });
    if (participant) participantIds.add(participant.id);
  }
  if (input.dedupStrategies.includes("PHONE") && input.phone) {
    const participant = await db.participant.findFirst({
      where: { organizationId: input.organizationId, phone: input.phone },
      select: { id: true },
    });
    if (participant) participantIds.add(participant.id);
  }

  const or: Prisma.ParticipationWhereInput[] = [];
  if (participantIds.size > 0) or.push({ participantId: { in: [...participantIds] } });
  if (input.dedupStrategies.includes("IP") && input.ip) or.push({ ipAddress: input.ip });
  if (input.dedupStrategies.includes("SESSION") && input.sessionId)
    or.push({ sessionId: input.sessionId });

  if (or.length === 0) return true;

  const count = await db.participation.count({
    where: {
      campaignId: input.campaignId,
      isTest: false,
      createdAt: { gte: windowStart },
      OR: or,
    },
  });

  return count < maxAllowed;
}
