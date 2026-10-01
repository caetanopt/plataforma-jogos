import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveOrgContext } from "@/server/auth/session";
import { can } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { parseSubjectIdentifier } from "@/lib/validation/privacy";
import { emptySubjectExportProgress, subjectExportChunks } from "@/features/privacy/subject-export";

const bodySchema = z.object({ subject: z.string().max(254) });

/**
 * Exportação dos dados de um titular (§24, RGPD art. 15.º): um JSON com
 * tudo o que a organização guarda sobre o e-mail ou o telefone pedidos (ver
 * subject-export.ts: as participações dele, as menções noutras e os dados
 * antigos de participante).
 *
 * POST com o identificador no corpo, nunca na query: um e-mail no URL ficava
 * nos logs de pedidos da plataforma e no histórico do browser. O corpo é
 * JSON e a origem tem de ser a da página: um formulário de outro site não
 * consegue fazer o pedido.
 *
 * Fica na auditoria antes do primeiro byte e no fim, só com contagens e o
 * tipo de identificador — nunca o e-mail ou o telefone.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  }
  const result = await resolveOrgContext();
  if (!result.ok) {
    return result.reason === "suspended"
      ? NextResponse.json({ error: "Organização suspensa." }, { status: 403 })
      : NextResponse.json({ error: "Sessão necessária." }, { status: 401 });
  }
  const { context } = result;
  const base = {
    organizationId: context.organizationId,
    userId: context.userId,
    action: "EXPORT" as const,
    entityType: "Participation",
  };
  if (!can(context, "privacy:manage")) {
    await logAudit({ ...base, result: "FAILURE", metadata: { scope: "subject", reason: "forbidden" } });
    return NextResponse.json({ error: "Sem permissão para exportar os dados de um titular." }, { status: 403 });
  }

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 415 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const subject = parsed.success ? parseSubjectIdentifier(parsed.data.subject) : null;
  if (!subject) {
    return NextResponse.json({ error: "Indique o e-mail ou o telefone completo do titular." }, { status: 400 });
  }

  const progress = emptySubjectExportProgress();
  const audit = (outcome: "SUCCESS" | "FAILURE", extra: Record<string, string>) =>
    logAudit({
      ...base,
      result: outcome,
      metadata: { scope: "subject", identifierKind: subject.kind, ...progress, ...extra },
    });
  await audit("SUCCESS", { stage: "started" });

  const encoder = new TextEncoder();
  const chunks = subjectExportChunks(context.organizationId, subject, { progress });
  // O cabeçalho do ficheiro já faz as procuras: uma falha aqui ainda chega
  // ao browser como erro, em vez de um download partido com estado 200.
  let head: IteratorResult<string>;
  try {
    head = await chunks.next();
  } catch (error) {
    const name = error instanceof Error ? error.name : typeof error;
    console.error(`[subject-export] falha antes de começar (${name})`);
    await audit("FAILURE", { stage: "interrupted", reason: "error" }).catch(() => undefined);
    return NextResponse.json({ error: "A exportação falhou. Tente de novo." }, { status: 500 });
  }
  let finished = false;
  // O ficheiro já saiu inteiro: uma falha a gravar o registo final fica no
  // log (só o nome do erro), sem estragar o download.
  const finish = (outcome: "SUCCESS" | "FAILURE", extra: Record<string, string>) => {
    finished = true;
    return audit(outcome, extra).catch((error: unknown) => {
      const name = error instanceof Error ? error.name : typeof error;
      console.error(`[subject-export] registo final da auditoria não gravado (${extra.stage}, ${name})`);
    });
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (!head.done) controller.enqueue(encoder.encode(head.value));
    },
    async pull(controller) {
      if (finished) return;
      try {
        const next = await chunks.next();
        if (finished) return;
        if (next.done) {
          await finish("SUCCESS", { stage: "completed" });
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        if (finished) return;
        const name = error instanceof Error ? error.name : typeof error;
        console.error(`[subject-export] falha a meio da exportação (${name})`);
        await finish("FAILURE", { stage: "interrupted", reason: "error" });
        controller.error(error);
      }
    },
    async cancel() {
      if (finished) return;
      const audited = finish("FAILURE", { stage: "interrupted", reason: "cancelled" });
      await chunks.return(undefined);
      await audited;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Sem o identificador no nome: fica na lista de transferências.
      "Content-Disposition": `attachment; filename="dados-titular-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
      // Contados ao procurar, antes de escrever o ficheiro (uma participação
      // anonimizada entretanto já não sai): o backoffice conta pelo ficheiro.
      "X-Subject-Participations": String(progress.matched),
      "X-Subject-Mentions": String(progress.mentionsMatched),
      "X-Subject-Legacy": String(progress.legacyParticipants),
    },
  });
}
