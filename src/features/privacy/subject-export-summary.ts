/**
 * O que o backoffice diz depois de descarregar a exportação de um titular
 * (§24): conta o que o próprio ficheiro leva, e não os cabeçalhos da
 * resposta, que são contados antes de o ficheiro ser escrito (uma
 * participação anonimizada entretanto já não sai).
 *
 * Sem dependências do servidor: corre no browser.
 */

/** As listas do ficheiro, pelas chaves que ele usa (ver subject-export.ts). */
export const SUBJECT_EXPORT_LISTS = {
  participations: "Participações",
  mentions: "Menções noutras participações",
  legacy: "Dados antigos de participante",
} as const;

export type SubjectExportCounts = Record<keyof typeof SUBJECT_EXPORT_LISTS, number>;

/**
 * As contagens do ficheiro, ou `null` quando o texto não é o ficheiro da
 * exportação (um JSON cortado a meio, uma página de erro): esse não se
 * entrega ao titular.
 */
export function countSubjectExport(text: string): SubjectExportCounts | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  if (!file || typeof file !== "object" || Array.isArray(file)) return null;
  const record = file as Record<string, unknown>;
  // As participações estão sempre lá (vazias, se não houver): sem elas não
  // é este ficheiro.
  if (!Array.isArray(record[SUBJECT_EXPORT_LISTS.participations])) return null;
  const length = (key: string) => {
    const value = record[key];
    return Array.isArray(value) ? value.length : 0;
  };
  return {
    participations: length(SUBJECT_EXPORT_LISTS.participations),
    mentions: length(SUBJECT_EXPORT_LISTS.mentions),
    legacy: length(SUBJECT_EXPORT_LISTS.legacy),
  };
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `1 ${one}` : `${count} ${many}`;
}

/** «a, b e c». */
function joinList(parts: string[]): string {
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** A frase que confirma o download, com o que o ficheiro leva. */
export function describeSubjectExport(counts: SubjectExportCounts): string {
  const parts = [
    counts.participations > 0 && plural(counts.participations, "participação", "participações"),
    counts.mentions > 0 && plural(counts.mentions, "menção noutra participação", "menções noutras participações"),
    counts.legacy > 0 && plural(counts.legacy, "registo antigo", "registos antigos"),
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    return "Ficheiro descarregado: sem dados com este e-mail ou telefone (o ficheiro diz isso ao titular).";
  }
  return `Ficheiro descarregado: ${joinList(parts)}.`;
}
