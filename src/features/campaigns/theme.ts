import { prisma } from "@/server/db/client";

/**
 * Cria a cópia de tema (Brand Kit) para uma nova campanha. Cada campanha
 * recebe sempre a sua própria cópia (secção 10) para evitar que alterações
 * posteriores ao brand kit afetem campanhas já criadas.
 */
export async function createCampaignTheme(organizationId: string) {
  const defaultKit = await prisma.campaignTheme.findFirst({
    where: { organizationId, isBrandKit: true },
    orderBy: { createdAt: "asc" },
  });

  return prisma.campaignTheme.create({
    data: {
      organizationId,
      name: "Tema da campanha",
      isBrandKit: false,
      sourceBrandKitId: defaultKit?.id,
      logoMediaId: defaultKit?.logoMediaId,
      faviconMediaId: defaultKit?.faviconMediaId,
      backgroundImageMediaId: defaultKit?.backgroundImageMediaId,
      primaryColor: defaultKit?.primaryColor,
      secondaryColor: defaultKit?.secondaryColor,
      backgroundColor: defaultKit?.backgroundColor,
      textColor: defaultKit?.textColor,
      buttonColor: defaultKit?.buttonColor,
      buttonTextColor: defaultKit?.buttonTextColor,
      fontFamily: defaultKit?.fontFamily,
      borderRadiusPx: defaultKit?.borderRadiusPx,
      shadowEnabled: defaultKit?.shadowEnabled,
      headerConfig: defaultKit?.headerConfig ?? undefined,
      footerConfig: defaultKit?.footerConfig ?? undefined,
      legalLinks: defaultKit?.legalLinks ?? undefined,
    },
  });
}
