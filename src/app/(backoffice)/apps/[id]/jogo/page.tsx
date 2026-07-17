import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { Alert } from "@/components/ui/alert";
import { MemoryGameStep } from "@/components/backoffice/editor/memory-game-step";
import { WheelGameStep } from "@/components/backoffice/editor/wheel-game-step";
import { QuizGameStep } from "@/components/backoffice/editor/quiz-game-step";

const LIVE_STATUSES = ["PUBLISHED", "SCHEDULED", "PAUSED"] as const;

export default async function GameConfigStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    select: { type: true, status: true },
  });
  if (!campaign) notFound();

  // A publicação cria uma CampaignVersion imutável, mas o jogo em si (pesos
  // da roda, prémios, respostas certas do quiz, pares da memória) é sempre
  // lido "live" a partir da configuração atual, nunca do snapshot — alterar
  // aqui depois de já haver participações reais afeta-as de imediato, sem
  // gerar uma nova versão. Avisar em vez de bloquear, porque editar depois
  // de publicar (ex.: repor stock) também é um fluxo legítimo.
  const hasRealParticipations =
    LIVE_STATUSES.includes(campaign.status as (typeof LIVE_STATUSES)[number]) &&
    (await prisma.participation.count({ where: { campaignId: id, isTest: false } })) > 0;

  return (
    <div className="space-y-4">
      {hasRealParticipations && (
        <Alert variant="info">
          Esta campanha já tem participações reais e está ativa. Alterar a configuração do jogo
          (pesos, prémios, respostas corretas, pares) aplica-se de imediato a novas participações,
          sem criar uma nova versão publicada.
        </Alert>
      )}
      {campaign.type === "MEMORY" && <MemoryGameStep campaignId={id} />}
      {campaign.type === "WHEEL" && <WheelGameStep campaignId={id} />}
      {campaign.type === "QUIZ" && <QuizGameStep campaignId={id} />}
    </div>
  );
}
