import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig } from "next-auth";
import { prisma } from "@/server/db/client";
import { verifyPassword } from "@/lib/security/password";
import { loginSchema } from "@/lib/validation/auth";
import { logAudit } from "@/server/audit/log";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const authConfig: NextAuthConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(rawCredentials) {
        const parsed = loginSchema.safeParse(rawCredentials);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const rateLimit = await checkRateLimit(`login:${email}`, 10, 15 * 60);
        if (!rateLimit.allowed) {
          await logAudit({
            action: "LOGIN_FAILED",
            entityType: "User",
            result: "FAILURE",
            metadata: { reason: "rate_limited" },
          });
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive) {
          await logAudit({
            action: "LOGIN_FAILED",
            entityType: "User",
            entityId: user?.id ?? null,
            result: "FAILURE",
            metadata: { reason: user ? "user_inactive" : "user_not_found" },
          });
          return null;
        }

        const validPassword = await verifyPassword(password, user.passwordHash);
        if (!validPassword) {
          await logAudit({
            action: "LOGIN_FAILED",
            entityType: "User",
            entityId: user.id,
            result: "FAILURE",
            metadata: { reason: "invalid_password" },
          });
          return null;
        }

        const firstMembership = await prisma.membership.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: "asc" },
        });

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        await logAudit({
          action: "LOGIN",
          entityType: "User",
          entityId: user.id,
          organizationId: firstMembership?.organizationId ?? null,
          userId: user.id,
          result: "SUCCESS",
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          isSuperAdmin: user.isSuperAdmin,
          activeOrganizationId: firstMembership?.organizationId ?? null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.isSuperAdmin = user.isSuperAdmin;
        token.activeOrganizationId = user.activeOrganizationId;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.userId;
      session.user.isSuperAdmin = token.isSuperAdmin;
      session.user.activeOrganizationId = token.activeOrganizationId;
      return session;
    },
  },
};
