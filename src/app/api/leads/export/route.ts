import { NextResponse } from "next/server";
import { resolveOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { resolveDateRange } from "@/lib/dates/range";
import {
  iterateLeadsForExport,
  listCampaignConsentDefinitions,
  parseMarketingConsentFilter,
} from "@/features/leads/queries";
import { csvHeader, csvLine, toLeadRow } from "@/features/leads/format";

export async function GET(request: Request) {
  // 401/403 em vez do redirect para o login (307) ou do erro 500 de um
  // assertCan falhado. A tentativa recusada fica na auditoria (§26).
  const result = await resolveOrgContext();
  if (!result.ok) {
    return result.reason === "suspended"
      ? NextResponse.json({ error: "Organização suspensa." }, { status: 403 })
      : NextResponse.json({ error: "Sessão necessária." }, { status: 401 });
  }
  const { context } = result;
  if (!can(context, "leads:export")) {
    await logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "EXPORT",
      entityType: "Participation",
      result: "FAILURE",
      metadata: { reason: "forbidden" },
    });
    return NextResponse.json({ error: "Sem permissão para exportar leads." }, { status: 403 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const range = resolveDateRange(params);

  const marketingConsent = parseMarketingConsentFilter(params.marketingConsent);
  const filters = {
    campaignId: params.campaignId || undefined,
    search: params.search || undefined,
    excludeTest: params.excludeTest !== "false",
    marketingConsent,
  };

  // Uma campanha: uma coluna por consentimento do formulário, além do resumo.
  const consentColumns = params.campaignId
    ? (await listCampaignConsentDefinitions(context.organizationId, params.campaignId)).map((definition) => ({
        definitionId: definition.id,
        text: definition.text,
        version: definition.version,
      }))
    : [];

  const audit = (result: "SUCCESS" | "FAILURE", count: number, extra: Record<string, unknown> = {}) =>
    logAudit({
      organizationId: context.organizationId,
      userId: context.userId,
      action: "EXPORT",
      entityType: "Participation",
      entityId: params.campaignId || "all",
      result,
      // Nunca incluir `params.search` — é o mesmo campo de pesquisa por
      // nome/e-mail/telefone (src/features/leads/queries.ts), por isso pode
      // conter dados pessoais de um lead. Só se regista se a exportação usou
      // pesquisa, não o texto pesquisado.
      metadata: {
        count,
        hadSearch: Boolean(params.search),
        filters: {
          campaignId: params.campaignId ?? null,
          excludeTest: params.excludeTest,
          marketingConsent: marketingConsent ?? null,
          preset: range.preset,
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        },
        ...extra,
      },
    });

  // Um registo antes do primeiro byte (§26): se o processo morrer a meio
  // (tempo máximo da plataforma, deploy), a saída dos dados fica registada.
  await audit("SUCCESS", 0, { stage: "started" });

  // Em streaming, por lotes (iterateLeadsForExport): antes a exportação
  // inteira ficava em memória, três vezes. No fim, um segundo registo diz
  // quantas linhas saíram, ou que a exportação foi interrompida — um só:
  // um download cancelado a meio de um lote escrevia dois (erro e
  // cancelamento) e um erro falso no log.
  const encoder = new TextEncoder();
  const batches = iterateLeadsForExport(context.organizationId, range, filters);
  let count = 0;
  let headerSent = false;
  let finished = false;
  const finish = (result: "SUCCESS" | "FAILURE", extra: Record<string, unknown>) => {
    finished = true;
    return audit(result, count, extra).catch(() => undefined);
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      try {
        if (!headerSent) {
          headerSent = true;
          // BOM: sem ele o Excel lê o UTF-8 como Latin-1 e parte os acentos.
          controller.enqueue(encoder.encode(`\uFEFF${csvHeader(consentColumns)}`));
          return;
        }
        const next = await batches.next();
        // Cancelado enquanto o lote era lido: já não há para onde o mandar.
        if (finished) return;
        if (next.done) {
          await finish("SUCCESS", { stage: "completed" });
          controller.close();
          return;
        }
        const lines = next.value.map((participation) => `\n${csvLine(toLeadRow(participation), consentColumns)}`);
        controller.enqueue(encoder.encode(lines.join("")));
        count += next.value.length;
      } catch (error) {
        if (finished) return;
        const name = error instanceof Error ? error.name : typeof error;
        console.error(`[leads-export] falha a meio da exportação (${name})`);
        await finish("FAILURE", { stage: "interrupted", reason: "error" });
        controller.error(error);
      }
    },
    async cancel() {
      if (finished) return;
      const audited = finish("FAILURE", { stage: "interrupted", reason: "cancelled" });
      await batches.return(undefined);
      await audited;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
