import NextAuth from "next-auth";
import { authConfig } from "@/server/auth/config";
import { prisma } from "@/server/db/client";

const nextAuth = NextAuth(authConfig);

export const handlers = nextAuth.handlers;
export const signIn = nextAuth.signIn;
export const signOut = nextAuth.signOut;

/**
 * Bypass temporário de autenticação para a fase de construção (DISABLE_AUTH=true
 * em .env). Autentica sempre como o utilizador ativo mais antigo (tipicamente
 * o admin semeado), sem exigir login. Remover/desligar antes de expor a
 * plataforma a utilizadores reais — ver secção "Regras para o Claude Code" do
 * CLAUDE.md sobre autorização no servidor.
 */
async function bypassAuth() {
  const user = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!user) return null;

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      activeOrganizationId: membership?.organizationId ?? null,
    },
  };
}

export const auth: typeof nextAuth.auth =
  process.env.DISABLE_AUTH === "true" ? (bypassAuth as typeof nextAuth.auth) : nextAuth.auth;
