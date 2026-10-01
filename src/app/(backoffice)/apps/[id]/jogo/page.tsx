import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/page-guard";
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
  const context = await requirePagePermission("campaign:edit");
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
    (await prisma.participation.findFirst({ where: { campaignId: id, isTest: false }, select: { id: true } })) !== null;

  const notice = hasRealParticipations ? (
    <Alert variant="info">
      Esta campanha já tem participações reais e está ativa. Alterar a configuração do jogo
      (pesos, prémios, respostas corretas, pares) aplica-se de imediato a novas participações,
      sem criar uma nova versão publicada.
    </Alert>
  ) : null;

  // O aviso vai para dentro da etapa, por baixo do título dela.
  return (
    <>
      {campaign.type === "MEMORY" && <MemoryGameStep campaignId={id} notice={notice} />}
      {campaign.type === "WHEEL" && <WheelGameStep campaignId={id} notice={notice} />}
      {campaign.type === "QUIZ" && <QuizGameStep campaignId={id} notice={notice} />}
    </>
  );
}
