import "dotenv/config";
import { clearLegacyParticipantIdentity, legacyIdentityReport } from "../src/features/privacy/legacy-identity";
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
 * Com o DATABASE_URL da base de dados a tratar. Imprime só contagens.
 */
/** Um erro nas opções: a mensagem não tem dados, pode ir para o terminal. */
class UsageError extends Error {}

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
    if (!report.migrationApplied) console.log(`A migração da identidade ainda não correu: não há nada a fazer antes dela.`);
    if (report.leadsOnlyOnParticipant > 0) {
      console.log(
        `${report.leadsOnlyOnParticipant} leads só têm a identidade no participante: confirme-as na lista de leads antes de apagar (ou use --accept-loss).`,
      );
    }
    return;
  }

  const result = await clearLegacyParticipantIdentity({ ...scope, acceptLoss: args.has("--accept-loss") });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "refused") process.exitCode = 2;
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
