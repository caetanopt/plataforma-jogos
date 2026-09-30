import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDataRetention } from "@/features/privacy/retention-job";

// A anonimização corre por lotes e pára antes deste limite (ver o
// timeBudgetMs abaixo); o que faltar fica para o dia seguinte.
export const maxDuration = 300;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header ?? "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Tarefa diária do prazo de conservação (§24), chamada pelo Vercel Cron
 * (vercel.json), que envia `Authorization: Bearer $CRON_SECRET`. Sem o
 * segredo configurado recusa sempre: um endpoint que apaga dados pessoais
 * não pode ficar aberto. O backoffice avisa quando a tarefa deixa de correr.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[retention] CRON_SECRET não está definido: a tarefa de conservação dos dados não corre.");
    return NextResponse.json({ error: "Tarefa por configurar." }, { status: 503 });
  }
  if (!authorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const summary = await runDataRetention({ timeBudgetMs: 240_000 });
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
