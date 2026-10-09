import NextAuth from "next-auth";
import { authConfig } from "@/server/auth/config";
import { AUTH_BYPASS_MODE, isLoginBypassed } from "@/server/auth/bypass";
import { prisma } from "@/server/db/client";

const nextAuth = NextAuth(authConfig);

export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;

/**
 * Sessão de quem entra sem login (ver `isLoginBypassed`): o utilizador ativo
 * mais antigo (tipicamente o admin semeado). Um pedido que não entra sem login
 * — em produção, o que não vem do domínio de produção — usa a sessão real.
 *
 * `isLoginBypassed` lê os headers do pedido, e isso mantém as rotas dinâmicas
 * como o `auth()` real (que lê cookies): sem esse sinal, o Next tentava
 * pré-renderizar páginas como /apps/new no build, com acesso à base de dados.
 */
async function bypassAuth() {
  if (!(await isLoginBypassed())) return nextAuth.auth();

  const user = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!user) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });
  // O JWT real guarda a organização ativa mesmo depois de a membership
  // desaparecer. Sem o mesmo aqui, um superadmin sem membership deixava o
  // backoffice inteiro em /login?error=no_organization, sem forma de entrar.
  const fallbackOrganization =
    !membership && user.isSuperAdmin
      ? await prisma.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } })
      : null;

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      activeOrganizationId: membership?.organizationId ?? fallbackOrganization?.id ?? null,
    },
  };
}

export const auth: typeof nextAuth.auth =
  AUTH_BYPASS_MODE === "off" ? nextAuth.auth : (bypassAuth as typeof nextAuth.auth);
