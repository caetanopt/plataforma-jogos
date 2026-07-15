"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/server/auth";
import { prisma } from "@/server/db/client";
import { hashPassword } from "@/lib/security/password";
import {
  requestPasswordResetSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";
import { sendMail } from "@/server/mail/mailer";
import { passwordResetEmail } from "@/features/auth/email-templates";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getRequestIp } from "@/lib/security/request-ip";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export async function loginAction(formData: FormData): Promise<void> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect("/login?error=invalid_credentials");
    }
    throw error;
  }
}

export async function requestPasswordResetAction(formData: FormData): Promise<void> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });

  if (parsed.success) {
    const rateLimit = await checkRateLimit(`password-reset:${parsed.data.email}`, 5, 60 * 60);
    if (rateLimit.allowed) {
      const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
      if (user && user.isActive) {
        const token = randomBytes(32).toString("hex");
        await prisma.passwordResetToken.create({
          data: { userId: user.id, token, expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
        });
        const { subject, html, text } = passwordResetEmail(token);
        await sendMail({ to: user.email, subject, html, text });
      }
    }
  }

  // Resposta sempre igual, exista ou não a conta, para não permitir enumeração de e-mails.
  redirect("/forgot-password?sent=1");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");

  // Limite por token: útil sobretudo contra reenvios acidentais do mesmo pedido.
  const tokenRateLimit = await checkRateLimit(`reset-password-attempt:${token}`, 10, 60 * 60);
  // Limite por IP: a defesa real contra um atacante a testar muitos tokens
  // diferentes (o limite por token, por si só, recomeça do zero a cada
  // token novo, por isso não trava esse padrão de ataque).
  const ip = await getRequestIp();
  const ipRateLimit = await checkRateLimit(`reset-password-attempt-ip:${ip ?? "unknown"}`, 20, 60 * 60);
  if (!tokenRateLimit.allowed || !ipRateLimit.allowed) {
    redirect("/login?error=reset_token_invalid");
  }

  const parsed = resetPasswordSchema.safeParse({
    token,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    redirect(`/reset-password/${token}?error=validation`);
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { token: parsed.data.token },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    redirect("/login?error=reset_token_invalid");
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, emailVerifiedAt: new Date() },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  redirect("/login?reset=success");
}
