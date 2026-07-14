import { auth } from "@/server/auth";
import { can } from "@/server/permissions";
import { prisma } from "@/server/db/client";

/**
 * O modo de teste (secção 18) só é honrado para quem está autenticado e tem
 * permissão de edição na organização da campanha — nunca para visitantes
 * anónimos, para não se tornar uma forma de contornar limites/stock.
 */
export async function canTestCampaign(organizationId: string): Promise<boolean> {
  const session = await auth();
  if (!session?.user) return false;
  if (session.user.isSuperAdmin) return true;
  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.user.id, organizationId } },
  });
  return can(
    { isSuperAdmin: false, membership, userId: session.user.id, userName: "", userEmail: "", organizationId },
    "campaign:edit",
  );
}
