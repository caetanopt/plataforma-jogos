import type { DedupStrategy, ParticipationLimitType, Prisma } from "@/generated/prisma/client";

export interface ParticipationLimitCheckInput {
  organizationId: string;
  campaignId: string;
  limitType: ParticipationLimitType;
  customMax: number | null;
  dedupStrategies: DedupStrategy[];
  cookieId?: string | null;
  /**
   * Já normalizados (`normalizeEmail`, `normalizePhone`), tal como estão
   * gravados na participação.
   */
  email?: string | null;
  phone?: string | null;
  ip?: string | null;
  sessionId?: string | null;
  /**
   * Participação que está a ser validada, fora da contagem. Na submissão do
   * formulário a participação já existe; contá-la fazia com que quem voltasse
   * no dia seguinte fosse aceite no início e recusado como "duplicado" ao
   * enviar o formulário.
   */
  excludeParticipationId?: string;
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
 * E-mail e telefone comparam-se com a identidade gravada em cada
 * participação, não com o Participant: esse é partilhado por quem usa o
 * mesmo browser e só guardava os dados da última pessoa.
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

  const or: Prisma.ParticipationWhereInput[] = [];
  if (input.cookieId) {
    const participant = await db.participant.findFirst({
      where: { organizationId: input.organizationId, cookieId: input.cookieId },
      select: { id: true },
    });
    if (participant) or.push({ participantId: participant.id });
  }
  if (input.dedupStrategies.includes("EMAIL") && input.email) or.push({ email: input.email });
  if (input.dedupStrategies.includes("PHONE") && input.phone) or.push({ phone: input.phone });
  if (input.dedupStrategies.includes("IP") && input.ip) or.push({ ipAddress: input.ip });
  if (input.dedupStrategies.includes("SESSION") && input.sessionId)
    or.push({ sessionId: input.sessionId });

  if (or.length === 0) return true;

  const count = await db.participation.count({
    where: {
      campaignId: input.campaignId,
      isTest: false,
      createdAt: { gte: windowStart },
      ...(input.excludeParticipationId ? { id: { not: input.excludeParticipationId } } : {}),
      OR: or,
    },
  });

  return count < maxAllowed;
}
