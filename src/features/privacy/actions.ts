"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
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
} from "@/lib/validation/privacy";
import { anonymizeParticipationsByIds } from "@/features/privacy/anonymize";
import { iterateLeadIdsToAnonymize } from "@/features/leads/queries";
import { leadsFiltersFromParams, type LeadsQueryParams } from "@/features/leads/filters";

function leadsWord(count: number): string {
  return count === 1 ? "1 lead" : `${count} leads`;
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

    await prisma.organization.update({
      where: { id: context.organizationId },
      data: { dataRetentionDays: parsed.data },
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
    return ok();
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

    const campaign = await prisma.campaign.findFirst({
      where: { id: getField(formData, "campaignId"), organizationId: context.organizationId },
      select: { id: true, timezone: true },
    });
    if (!campaign) notFound();

    const parsed = campaignRetentionSchema.safeParse(
      campaignRetentionFromForm(getField(formData, "retention"), getField(formData, "retentionUntil")),
    );
    if (!parsed.success) {
      const errors = zodFieldErrors(parsed.error);
      return fail("O prazo não foi guardado.", {
        ...(errors.date ? { retentionUntil: errors.date } : { retention: "Prazo de conservação: opção inválida." }),
      });
    }

    let data: { dataRetentionDays: number | null; dataRetentionUntil: Date | null };
    if (parsed.data.mode === "until") {
      const until = zonedDateTimeToUtc(`${parsed.data.date}T00:00`, campaign.timezone);
      // Uma data já passada anonimizava tudo na execução seguinte: para isso
      // há a anonimização manual, na lista de leads, que pede confirmação.
      if (!until || until.getTime() <= Date.now()) {
        return fail("O prazo não foi guardado.", { retentionUntil: "Data de anonimização: tem de ser depois de hoje." });
      }
      data = { dataRetentionDays: null, dataRetentionUntil: until };
    } else if (parsed.data.mode === "days") {
      data = { dataRetentionDays: parsed.data.days, dataRetentionUntil: null };
    } else {
      data = { dataRetentionDays: null, dataRetentionUntil: null };
    }

    await prisma.campaign.update({ where: { id: campaign.id }, data });
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
    return ok();
  });
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
 * Anonimização manual de leads (§21, §24), a pedido do titular ou por
 * decisão da organização. Irreversível: o botão pede confirmação, e a
 * operação fica na auditoria, só com contagens e os filtros (sem o texto
 * pesquisado, que pode ser um e-mail).
 *
 * - "selection": as leads marcadas na lista;
 * - "filters": todas as que os filtros da lista apanham nesse momento.
 */
export async function anonymizeLeadsAction(_previous: ActionResult, formData: FormData): Promise<ActionResult> {
  return runAction("anonymizeLeads", async () => {
    const context = await requireOrgContext();
    assertCan(context, "privacy:manage");

    const scope = getField(formData, "scope");
    const now = new Date();
    let requested = 0;
    const total = { participationsAnonymized: 0, participantsDeleted: 0, skipped: 0 };
    let auditFilters: Record<string, string | boolean | null> = {};
    let hadSearch = false;

    if (scope === "selection") {
      const parsed = anonymizeSelectionSchema.safeParse(readMultiple(formData, "participationId") ?? []);
      if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Selecione pelo menos uma lead.");
      requested = parsed.data.length;
      Object.assign(total, await anonymizeParticipationsByIds(context.organizationId, parsed.data, now));
    } else if (scope === "filters") {
      const params = Object.fromEntries(
        FILTER_KEYS.map((key) => [key, formData.get(key)]).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ) as LeadsQueryParams;
      const { range, filters } = leadsFiltersFromParams(params);
      hadSearch = Boolean(filters.search);
      auditFilters = {
        campaignId: filters.campaignId ?? null,
        excludeTest: filters.excludeTest !== false,
        hideAnonymized: filters.hideAnonymized ?? false,
        marketingConsent: filters.marketingConsent ?? null,
        preset: range.preset,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      };
      for await (const ids of iterateLeadIdsToAnonymize(context.organizationId, range, filters)) {
        requested += ids.length;
        const counts = await anonymizeParticipationsByIds(context.organizationId, ids, now);
        total.participationsAnonymized += counts.participationsAnonymized;
        total.participantsDeleted += counts.participantsDeleted;
        total.skipped += counts.skipped;
      }
    } else {
      return fail("Pedido inválido.");
    }

    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "PRIVACY_OPERATION",
      entityType: "Participation",
      entityId: typeof auditFilters.campaignId === "string" ? auditFilters.campaignId : null,
      result: "SUCCESS",
      metadata: {
        operation: "anonymize",
        scope,
        requested,
        ...total,
        ...(scope === "filters" ? { hadSearch, filters: auditFilters } : {}),
      },
    });

    revalidatePath("/leads");
    if (total.participationsAnonymized === 0 && total.skipped === 0) {
      return ok("Não havia leads por anonimizar.");
    }
    const skipped =
      total.skipped > 0
        ? ` ${leadsWord(total.skipped)} a ser usadas neste momento (um jogo a decorrer) ficaram por anonimizar: tente de novo daqui a pouco.`
        : "";
    return ok(`${leadsWord(total.participationsAnonymized)} anonimizada${total.participationsAnonymized === 1 ? "" : "s"}.${skipped}`);
  });
}
