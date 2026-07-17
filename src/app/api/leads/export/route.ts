import { NextResponse } from "next/server";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { resolveDateRange } from "@/lib/dates/range";
import { listLeadsForExport } from "@/features/leads/queries";
import { leadsToCsv, toLeadRow } from "@/features/leads/format";

export async function GET(request: Request) {
  const context = await requireOrgContext();
  assertCan(context, "leads:export");

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const range = resolveDateRange(params);

  const participations = await listLeadsForExport(context.organizationId, range, {
    campaignId: params.campaignId || undefined,
    search: params.search || undefined,
    excludeTest: params.excludeTest !== "false",
  });

  const csv = leadsToCsv(participations.map(toLeadRow));

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "EXPORT",
    entityType: "Participation",
    entityId: params.campaignId || "all",
    result: "SUCCESS",
    // Nunca incluir `params.search` — é o mesmo campo de pesquisa por
    // nome/e-mail/telefone (src/features/leads/queries.ts), por isso pode
    // conter dados pessoais de um lead. Só se regista se a exportação usou
    // pesquisa, não o texto pesquisado.
    metadata: {
      count: participations.length,
      hadSearch: Boolean(params.search),
      filters: {
        campaignId: params.campaignId ?? null,
        excludeTest: params.excludeTest,
        preset: range.preset,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
    },
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
