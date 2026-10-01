"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma, TRANSACTION_MAX_WAIT_MS } from "@/server/db/client";
import { requireOrgContext, type OrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { runAction } from "@/server/actions/run-action";
import { getField, readMultiple } from "@/lib/forms/form-data";
import { fail, ok, zodFieldErrors, type ActionResult } from "@/lib/forms/action-result";
import { zonedDateTimeToUtc } from "@/lib/dates/timezone";
import {
  anonymizeSelectionSchema,
  campaignRetentionFromForm,
  campaignRetentionSchema,
  organizationRetentionSchema,
  parseSubjectIdentifier,
} from "@/lib/validation/privacy";
import {
  anonymizeParticipationsByIds,
  clearSubjectFromParticipants,
  removeSubjectMentions,
  type AnonymizationCounts,
} from "@/features/privacy/anonymize";
import {
  countLeadsToAnonymize,
  countMentions,
  findSubjectParticipations,
  iterateLeadIdsToAnonymize,
  type SubjectIdentifier,
} from "@/features/leads/queries";
import { leadsFiltersFromParams, type LeadsQueryParams } from "@/features/leads/filters";
import { RETENTION_WARNING_DAYS } from "@/features/privacy/retention-policy";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Contagens da auditoria (só números, nunca o pedido). */
type AuditedCounts = AnonymizationCounts & Record<string, number>;

function emptyCounts() {
  return { participationsAnonymized: 0, participantsDeleted: 0 };
}

function leads(count: number): string {
  return count === 1 ? "1 lead" : `${count} leads`;
}

function anonymizedLeads(count: number): string {
  return count === 1 ? "1 lead anonimizada" : `${count} leads anonimizadas`;
}

/** Prazo de conservação por omissão da organização (Configurações, §24). */
export async function updateOrganizationRetentionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateOrganizationRetention", async () => {
    const context = await requireOrgContext();
    assertCan(context, "privacy:manage");

    const parsed = organizationRetentionSchema.safeParse(getField(formData, "dataRetentionDays"));
    if (!parsed.success) {
      return fail("O prazo não foi guardado.", { dataRetentionDays: parsed.error.issues[0]?.message ?? "Opção inválida." });
    }

    const current = await prisma.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
      select: { dataRetentionDays: true },
    });
    const changed = current.dataRetentionDays !== parsed.data;
    // A anonimização pelo prazo novo só começa 7 dias depois (retention-policy).
    await prisma.organization.update({
      where: { id: context.organizationId },
      data: { dataRetentionDays: parsed.data, ...(changed ? { dataRetentionChangedAt: new Date() } : {}) },
    });
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "Organization",
      entityId: context.organizationId,
      result: "SUCCESS",
      metadata: { fields: ["dataRetentionDays"], dataRetentionDays: parsed.data },
    });

    revalidatePath("/settings");
    revalidatePath("/leads");
    return ok(
      changed && parsed.data !== null
        ? `Prazo guardado. A anonimização por este prazo começa daqui a ${RETENTION_WARNING_DAYS} dias.`
        : undefined,
    );
  });
}

/**
 * Prazo de conservação de uma campanha: o da organização, em dias, ou uma
 * data a partir da qual tudo é anonimizado (hora 00:00 no fuso da campanha).
 */
export async function updateCampaignRetentionAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("updateCampaignRetention", async () => {
    const context = await requireOrgContext();
    assertCan(context, "privacy:manage");

    const owned = await prisma.campaign.findFirst({
      where: { id: getField(formData, "campaignId"), organizationId: context.organizationId },
      select: { id: true },
    });
    if (!owned) notFound();

    const parsed = campaignRetentionSchema.safeParse(
      campaignRetentionFromForm(getField(formData, "retention"), getField(formData, "retentionUntil")),
    );
    if (!parsed.success) {
      const errors = zodFieldErrors(parsed.error);
      return fail("O prazo não foi guardado.", {
        ...(errors.date ? { retentionUntil: errors.date } : { retention: "Prazo de conservação: opção inválida." }),
      });
    }
    const input = parsed.data;

    // O fuso lido e a data gravada com a campanha bloqueada: uma mudança de
    // fuso ao mesmo tempo (Informações do projeto) espera, e passa a data
    // para o fuso novo depois desta (ver moveCampaignTimezone).
    const saved = await prisma.$transaction(
      async (tx) => {
        const [campaign] = await tx.$queryRaw<
          Array<{ id: string; timezone: string; dataRetentionDays: number | null; dataRetentionUntil: Date | null }>
        >`SELECT "id", "timezone", "dataRetentionDays", "dataRetentionUntil" FROM "Campaign" WHERE "id" = ${owned.id} FOR NO KEY UPDATE`;
        if (!campaign) return null;

        let data: { dataRetentionDays: number | null; dataRetentionUntil: Date | null };
        if (input.mode === "until") {
          const until = zonedDateTimeToUtc(`${input.date}T00:00`, campaign.timezone);
          // Uma data próxima anonimizava tudo sem o aviso de 7 dias (e uma já
          // passada, na execução seguinte): para isso há a anonimização manual,
          // na lista de leads, que pede confirmação.
          if (!until || until.getTime() < Date.now() + RETENTION_WARNING_DAYS * DAY_MS) return { tooSoon: true as const };
          data = { dataRetentionDays: null, dataRetentionUntil: until };
        } else if (input.mode === "days") {
          data = { dataRetentionDays: input.days, dataRetentionUntil: null };
        } else {
          data = { dataRetentionDays: null, dataRetentionUntil: null };
        }

        const changed =
          data.dataRetentionDays !== campaign.dataRetentionDays ||
          data.dataRetentionUntil?.getTime() !== campaign.dataRetentionUntil?.getTime();
        await tx.campaign.update({
          where: { id: campaign.id },
          data: { ...data, ...(changed ? { dataRetentionChangedAt: new Date() } : {}) },
        });
        return { tooSoon: false as const, campaign, data, changed };
      },
      { maxWait: TRANSACTION_MAX_WAIT_MS, timeout: 15_000 },
    );
    if (!saved) notFound();
    if (saved.tooSoon) {
      return fail("O prazo não foi guardado.", {
        retentionUntil: `Data de anonimização: pelo menos ${RETENTION_WARNING_DAYS} dias depois de hoje, para dar tempo de exportar.`,
      });
    }
    const { campaign, data, changed } = saved;
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "UPDATE",
      entityType: "Campaign",
      entityId: campaign.id,
      result: "SUCCESS",
      metadata: {
        fields: ["dataRetention"],
        dataRetentionDays: data.dataRetentionDays,
        dataRetentionUntil: data.dataRetentionUntil?.toISOString() ?? null,
      },
    });

    revalidatePath(`/apps/${campaign.id}/formulario`);
    revalidatePath("/leads");
    return ok(
      changed && input.mode !== "inherit"
        ? `Prazo guardado. A anonimização por este prazo começa daqui a ${RETENTION_WARNING_DAYS} dias.`
        : undefined,
    );
  });
}

/**
 * Um registo antes de começar e outro no fim, também quando falha a meio.
 * `progress` (só contagens) vai sendo somado por quem corre, e entra no
 * registo final.
 */
async function audited<T, P extends AuditedCounts>(
  context: OrgContext,
  details: { scope: string; entityId?: string | null; metadata: Record<string, string | number | boolean | null> },
  progress: P,
  run: (progress: P) => Promise<T>,
): Promise<T> {
  const base = {
    organizationId: context.organizationId,
    userId: context.userId,
    action: "PRIVACY_OPERATION" as const,
    entityType: "Participation",
    entityId: details.entityId ?? null,
  };
  await logAudit({ ...base, result: "SUCCESS", metadata: { operation: "anonymize", stage: "started", scope: details.scope, ...details.metadata } });
  let outcome: "completed" | "interrupted" = "interrupted";
  try {
    const result = await run(progress);
    outcome = "completed";
    return result;
  } finally {
    // Cada lote confirma à parte: numa falha a meio, o que já saiu fica aqui.
    await logAudit({
      ...base,
      result: outcome === "completed" ? "SUCCESS" : "FAILURE",
      metadata: { operation: "anonymize", stage: outcome, scope: details.scope, ...details.metadata, ...progress },
    }).catch(() => undefined);
  }
}

function resultMessage(counts: AnonymizationCounts & { skipped: number }): ActionResult {
  if (counts.participationsAnonymized === 0 && counts.skipped === 0) return ok("Não havia leads por anonimizar.");
  if (counts.skipped > 0) {
    // Fica no ecrã (é uma falha parcial): as de um jogo a decorrer ficaram.
    const busy =
      counts.skipped === 1
        ? "1 lead estava a ser usada (um jogo a decorrer) e ficou por anonimizar"
        : `${counts.skipped} leads estavam a ser usadas (um jogo a decorrer) e ficaram por anonimizar`;
    return fail(`${anonymizedLeads(counts.participationsAnonymized)}. ${busy}: tente de novo daqui a pouco.`);
  }
  return ok(`${anonymizedLeads(counts.participationsAnonymized)}.`);
}

function participations(count: number): string {
  return count === 1 ? "1 participação" : `${count} participações`;
}

function mentionsIn(count: number): string {
  return count === 1 ? "1 menção noutra participação" : `${count} menções noutras participações`;
}

/** "e-mail" ou "telefone", para as mensagens do pedido de um titular. */
function identifierLabel(subject: SubjectIdentifier): string {
  return subject.kind === "email" ? "e-mail" : "telefone";
}

/**
 * «Procurar» no pedido de um titular: as participações dele e, à parte, as
 * menções em leads de outras pessoas — dessas só sai o campo.
 */
function subjectPreviewMessage(subject: SubjectIdentifier, identity: number, campaigns: number, mentions: number): string {
  const label = identifierLabel(subject);
  const mentionText =
    mentions > 0
      ? `${mentionsIn(mentions)} (um campo do formulário de outra pessoa com este ${label}: aí só esse campo sai, o resto da lead fica)`
      : "";
  if (identity === 0) {
    return mentions === 0
      ? "Nenhuma participação por anonimizar com este e-mail ou telefone exatos."
      : `Nenhuma participação com este ${label} exato; ${mentionText}.`;
  }
  const own = `${participations(identity)} com este ${label} exato, em ${campaigns === 1 ? "1 campanha" : `${campaigns} campanhas`}`;
  return mentions === 0 ? `${own}.` : `${own}, e ${mentionText}.`;
}

/** O resultado do pedido de um titular: as leads dele e os campos retirados das de outras pessoas. */
function subjectResultMessage(
  subject: SubjectIdentifier,
  counts: AnonymizationCounts & { skipped: number; mentionsCleared: number; mentionsSkipped: number },
): ActionResult {
  const label = identifierLabel(subject);
  const parts: string[] = [];
  if (counts.participationsAnonymized > 0) parts.push(`${anonymizedLeads(counts.participationsAnonymized)}.`);
  if (counts.mentionsCleared > 0) {
    parts.push(
      `${label === "e-mail" ? "E-mail retirado" : "Telefone retirado"} de ${mentionsIn(counts.mentionsCleared)}: só esse campo saiu, o resto ${counts.mentionsCleared === 1 ? "dessa lead, de outra pessoa," : "dessas leads, de outras pessoas,"} fica.`,
    );
  }
  const skipped = counts.skipped + counts.mentionsSkipped;
  if (skipped > 0) {
    // Fica no ecrã (é uma falha parcial): as de um jogo a decorrer ficaram.
    const busy =
      skipped === 1
        ? "1 participação estava a ser usada (um jogo a decorrer) e ficou por tratar"
        : `${skipped} participações estavam a ser usadas (um jogo a decorrer) e ficaram por tratar`;
    return fail(`${parts.join(" ")}${parts.length > 0 ? " " : ""}${busy}: tente de novo daqui a pouco.`);
  }
  return ok(parts.length > 0 ? parts.join(" ") : "Não havia leads por anonimizar.");
}

const FILTER_KEYS = [
  "campaignId",
  "search",
  "period",
  "from",
  "to",
  "excludeTest",
  "marketingConsent",
  "hideAnonymized",
] as const satisfies ReadonlyArray<keyof LeadsQueryParams>;

/**
 * Anonimização manual de leads (§21, §24). Irreversível: os botões pedem
 * confirmação, e a operação fica na auditoria, no início e no fim, só com
 * contagens (nunca o e-mail ou o telefone pedidos, nem o texto pesquisado).
 *
 * - "selection": as leads marcadas na lista;
 * - "filters": todas as que os filtros da lista apanham, tal como estavam
 *   quando a página foi mostrada (a contagem confirmada tem de bater certo).
 *   Sem pesquisa: a pesquisa da lista procura partes do texto e apanhava
 *   outras pessoas;
 * - "subject": um pedido de um titular, pelo e-mail ou telefone exatos, em
 *   todas as campanhas. As participações dele são anonimizadas por inteiro;
 *   nas de outras pessoas que o mencionam numa resposta (o e-mail de um
 *   amigo) só sai esse campo. Com intent "preview", só diz quantas encontra.
 */
export async function anonymizeLeadsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("anonymizeLeads", async () => {
    const context = await requireOrgContext();
    assertCan(context, "privacy:manage");

    const scope = getField(formData, "scope");
    const now = new Date();

    if (scope === "selection") {
      const parsed = anonymizeSelectionSchema.safeParse(readMultiple(formData, "participationId") ?? []);
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Selecione pelo menos uma lead.");
      const counts = await audited(context, { scope, metadata: { requested: parsed.data.length } }, emptyCounts(), (progress) =>
        anonymizeParticipationsByIds(context.organizationId, parsed.data, now, progress),
      );
      revalidatePath("/leads");
      return resultMessage(counts);
    }

    if (scope === "filters") {
      const params = Object.fromEntries(
        FILTER_KEYS.map((key) => [key, formData.get(key)]).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ) as LeadsQueryParams;
      const { range, filters } = leadsFiltersFromParams(params);
      if (filters.search) {
        return fail("Com uma pesquisa ativa, use «Pedido de um titular» (e-mail ou telefone exatos).");
      }
      const createdUpTo = new Date(getField(formData, "asOf"));
      const expected = Number(getField(formData, "expected"));
      if (Number.isNaN(createdUpTo.getTime()) || !Number.isInteger(expected)) return fail("Pedido inválido.");
      // O que o administrador confirmou: as que existiam quando viu a página.
      // Se o período (por exemplo "Hoje", à meia-noite) ou os dados mudaram
      // entretanto, recusa em vez de anonimizar outras.
      const current = await countLeadsToAnonymize(context.organizationId, range, filters, createdUpTo);
      if (current !== expected) {
        return fail(
          `A lista mudou desde que a abriu (${leads(current)} em vez de ${expected}). Recarregue a página, reveja os filtros e confirme de novo.`,
        );
      }
      const metadata = {
        requested: expected,
        campaignId: filters.campaignId ?? null,
        excludeTest: filters.excludeTest !== false,
        hideAnonymized: filters.hideAnonymized ?? false,
        marketingConsent: filters.marketingConsent ?? null,
        preset: range.preset,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        createdUpTo: createdUpTo.toISOString(),
      };
      const counts = await audited(context, { scope, entityId: filters.campaignId ?? null, metadata }, emptyCounts(), async (progress) => {
        const total = { participationsAnonymized: 0, participantsDeleted: 0, skipped: 0 };
        for await (const ids of iterateLeadIdsToAnonymize(context.organizationId, range, filters, { createdUpTo })) {
          const batch = await anonymizeParticipationsByIds(context.organizationId, ids, now, progress);
          total.participationsAnonymized += batch.participationsAnonymized;
          total.participantsDeleted += batch.participantsDeleted;
          total.skipped += batch.skipped;
        }
        return total;
      });
      revalidatePath("/leads");
      return resultMessage(counts);
    }

    if (scope === "subject") {
      const subject = parseSubjectIdentifier(getField(formData, "subject"));
      if (!subject) {
        return fail("Indique o e-mail ou o telefone completo do titular.", {
          subject: "Pedido de um titular: e-mail ou telefone completo.",
        });
      }
      const { identity, mentions } = await findSubjectParticipations(context.organizationId, subject);
      const campaigns = new Set(identity.map((match) => match.campaignId)).size;
      const mentionCount = countMentions(mentions);
      if (getField(formData, "intent") === "preview") {
        return ok(subjectPreviewMessage(subject, identity.length, campaigns, mentionCount));
      }
      const progress = { ...emptyCounts(), mentionsCleared: 0, legacyParticipantsCleared: 0 };
      const counts = await audited(
        context,
        {
          scope,
          metadata: { identifierKind: subject.kind, requested: identity.length, campaigns, mentions: mentionCount },
        },
        progress,
        async (progress) => {
          // As do titular por inteiro; das de outras pessoas, só o campo.
          const result = await anonymizeParticipationsByIds(
            context.organizationId,
            identity.map((match) => match.id),
            now,
            progress,
          );
          const cleared = await removeSubjectMentions(
            context.organizationId,
            subject,
            mentions.map((mention) => mention.id),
            progress,
          );
          progress.legacyParticipantsCleared = await clearSubjectFromParticipants(context.organizationId, subject, now);
          return { ...result, mentionsCleared: cleared.mentionsCleared, mentionsSkipped: cleared.skipped };
        },
      );
      revalidatePath("/leads");
      return subjectResultMessage(subject, counts);
    }

    return fail("Pedido inválido.");
  });
}
