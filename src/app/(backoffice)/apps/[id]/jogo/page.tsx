import { notFound } from "next/navigation";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { MemoryGameStep } from "@/components/backoffice/editor/memory-game-step";
import { WheelGameStep } from "@/components/backoffice/editor/wheel-game-step";
import { QuizGameStep } from "@/components/backoffice/editor/quiz-game-step";

export default async function GameConfigStepPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireOrgContext();
  const campaign = await prisma.campaign.findFirst({
    where: { id, organizationId: context.organizationId },
    select: { type: true },
  });
  if (!campaign) notFound();

  if (campaign.type === "MEMORY") {
    return <MemoryGameStep campaignId={id} />;
  }
  if (campaign.type === "WHEEL") {
    return <WheelGameStep campaignId={id} />;
  }

  return <QuizGameStep campaignId={id} />;
}
