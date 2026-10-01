import "dotenv/config";
import {
  clearLegacyParticipantIdentity,
  legacyIdentityReport,
  type LegacyIdentityReport,
} from "../src/features/privacy/legacy-identity";
import { prisma } from "../src/server/db/client";

/**
 * Limpeza dos dados pessoais antigos dos participantes (ver
 * src/features/privacy/legacy-identity.ts). Irreversível.
 *
 *   npm run privacy:clear-legacy                      só conta (simulação)
 *   npm run privacy:clear-legacy -- --apply           apaga
 *   npm run privacy:clear-legacy -- --apply --accept-loss
 *       apaga mesmo que haja leads com a identidade só no participante
 *   npm run privacy:clear-legacy -- --organization <id> [--apply]
 *       só uma organização
 *
 * Com o DATABASE_URL da base de dados a tratar, depois de
 * prisma/maintenance/backfill_participation_identity.sql (README, "Depois do
 * deploy"). Imprime só contagens e ids de participação, nunca dados pessoais,
 * também quando falha a meio.
 */
/** Um erro nas opções: a mensagem não tem dados, pode ir para o terminal. */
class UsageError extends Error {}

const BACKFILL = "npx prisma db execute --file prisma/maintenance/backfill_participation_identity.sql";

function explain(report: LegacyIdentityReport) {
  if (!report.migrationApplied) {
    console.log(
      "As migrações da identidade e da conservação ainda não correram: não há nada a contar nem a apagar antes delas.",
    );
    return;
  }
  if (report.leadsOnlyOnParticipant > 0) {
    console.log(
      `${report.leadsOnlyOnParticipant} leads só têm a identidade no participante. Corra primeiro ${BACKFILL} ` +
        "(completa as da janela do deploy a partir das respostas) e simule outra vez; as que ficarem estão em " +
        "participationIds (até 20 por organização). Para as perder na mesma: --apply --accept-loss.",
    );
  }
  if (report.ambiguousLeads > 0) {
    console.log(
      `${report.ambiguousLeads} leads de ${report.ambiguousParticipants} participantes com mais do que uma lead ` +
        "ficaram sem identidade de propósito na migração (os dados do participante podiam ser de outra pessoa): " +
        "não fazem recusar, e a limpeza apaga esses dados.",
    );
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const organizationAt = argv.indexOf("--organization");
  const organizationId = organizationAt >= 0 ? argv[organizationAt + 1] : undefined;
  if (organizationAt >= 0 && (!organizationId || organizationId.startsWith("--"))) {
    throw new UsageError("--organization precisa do id da organização.");
  }
  const args = new Set(
    organizationAt >= 0 ? argv.filter((_, index) => index !== organizationAt && index !== organizationAt + 1) : argv,
  );
  const unknown = [...args].filter((arg) => arg !== "--apply" && arg !== "--accept-loss");
  if (unknown.length > 0) throw new UsageError(`Opções desconhecidas: ${unknown.join(" ")}`);
  const scope = organizationId ? { organizationIds: [organizationId] } : {};

  if (!args.has("--apply")) {
    const report = await legacyIdentityReport(scope);
    console.log(JSON.stringify({ mode: "simulação (nada foi apagado)", ...report }, null, 2));
    explain(report);
    return;
  }

  const progress = new Map<string, number>();
  try {
    const result = await clearLegacyParticipantIdentity({ ...scope, acceptLoss: args.has("--accept-loss"), progress });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "refused") {
      explain(result.report);
      process.exitCode = 2;
    }
  } catch (error) {
    // Cada lote confirma à parte: o que já saiu não volta. Só contagens.
    const byOrganization = [...progress].map(([id, participants]) => ({ organizationId: id, participants }));
    console.error(
      JSON.stringify(
        {
          status: "interrupted",
          participantsCleared: byOrganization.reduce((sum, row) => sum + row.participants, 0),
          byOrganization,
        },
        null,
        2,
      ),
    );
    throw error;
  }
}

main()
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`[clear-legacy] ${error.message}`);
      process.exitCode = 64;
      return;
    }
    // Só o nome: a mensagem de uma query pode trazer valores.
    console.error(`[clear-legacy] falhou (${error instanceof Error ? error.name : typeof error})`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
