import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { PermissionDeniedError } from "@/server/permissions";
import { fail, type ActionResult } from "@/lib/forms/action-result";

/**
 * Código de erro da base de dados, pelas duas formas em que chega: o erro
 * conhecido do Prisma (P2002, P2003...) ou o erro do driver adapter, que traz
 * o tipo em `cause.kind`.
 */
function databaseErrorKind(error: unknown): "unique" | "foreign_key" | "not_found" | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "unique";
    if (error.code === "P2003") return "foreign_key";
    if (error.code === "P2025") return "not_found";
    return null;
  }
  const kind = (error as { cause?: { kind?: string } } | null)?.cause?.kind;
  if (kind === "UniqueConstraintViolation") return "unique";
  if (kind === "ForeignKeyConstraintViolation") return "foreign_key";
  return null;
}

export const UNEXPECTED_ERROR_MESSAGE =
  "Ocorreu um erro inesperado. Recarregue a página para confirmar o que ficou gravado.";

/**
 * Corre o corpo de uma server action e transforma as falhas numa resposta
 * que o formulário mostra, em vez do ecrã de erro genérico.
 *
 * - `redirect()` e `notFound()` atravessam (unstable_rethrow);
 * - falta de permissão, valores duplicados e registos em uso têm mensagem
 *   própria — a própria ação pode dar uma mais precisa antes de chegar aqui;
 * - o resto é registado só com o nome do erro (as mensagens do Prisma podem
 *   levar os valores da consulta, ou seja, dados pessoais).
 */
export async function runAction(label: string, body: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await body();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof PermissionDeniedError) {
      return fail("Não tem permissão para fazer esta alteração.");
    }
    switch (databaseErrorKind(error)) {
      case "unique":
        return fail("Já existe um registo com esse valor.");
      case "foreign_key":
        return fail("Não é possível: há dados que dependem deste registo.");
      case "not_found":
        return fail("O registo já não existe. Recarregue a página.");
    }
    const name = error instanceof Error ? error.name : typeof error;
    console.error(`[action:${label}] erro inesperado (${name})`);
    // Não se sabe se a gravação chegou a acontecer: a maioria das ações grava
    // primeiro e só depois audita, e uma falha na auditoria chegava aqui a
    // dizer "não foram guardadas" com a alteração já em vigor.
    return fail(UNEXPECTED_ERROR_MESSAGE);
  }
}

export { databaseErrorKind };
