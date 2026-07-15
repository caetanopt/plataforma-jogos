"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";
import { requireOrgContext } from "@/server/auth/session";
import { assertCan } from "@/server/permissions";
import { logAudit } from "@/server/audit/log";
import { hashPassword } from "@/lib/security/password";
import { sendMail } from "@/server/mail/mailer";
import { inviteUserEmail } from "@/features/auth/email-templates";
import { inviteUserSchema, updateMembershipSchema } from "@/lib/validation/users";
import { getField } from "@/lib/forms/form-data";

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

class LastAdminError extends Error {}

export async function inviteUserAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "user:manage");

  const parsed = inviteUserSchema.safeParse({
    name: getField(formData, "name"),
    email: getField(formData, "email"),
    role: getField(formData, "role"),
    canPublish: getField(formData, "canPublish"),
    canExportLeads: getField(formData, "canExportLeads"),
  });
  if (!parsed.success) {
    redirect("/users?error=validation");
  }

  const { name, email, role } = parsed.data;
  const canPublish = parsed.data.canPublish === "on";
  const canExportLeads = parsed.data.canExportLeads === "on";

  let user = await prisma.user.findUnique({ where: { email } });
  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    try {
      user = await prisma.user.create({
        data: { name, email, passwordHash: await hashPassword(randomBytes(24).toString("hex")) },
      });
    } catch (error) {
      // Corrida entre dois convites simultâneos para o mesmo e-mail ainda
      // inexistente: outro pedido criou o utilizador entretanto.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        user = await prisma.user.findUniqueOrThrow({ where: { email } });
        isNewUser = false;
      } else {
        throw error;
      }
    }
  }

  let membership;
  try {
    membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: context.organizationId, role, canPublish, canExportLeads },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      redirect("/users?error=already_member");
    }
    throw error;
  }

  if (isNewUser) {
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS) },
    });
    const organization = await prisma.organization.findUniqueOrThrow({ where: { id: context.organizationId } });
    const { subject, html, text } = inviteUserEmail(token, organization.name);
    await sendMail({ to: user.email, subject, html, text });
  }

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "PERMISSION_CHANGE",
    entityType: "Membership",
    entityId: membership.id,
    result: "SUCCESS",
    metadata: { action: "invite", role, isNewUser },
  });

  revalidatePath("/users");
}

export async function updateMembershipAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "user:manage");

  const membershipId = getField(formData, "membershipId");
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: context.organizationId },
  });
  if (!membership) notFound();

  const parsed = updateMembershipSchema.safeParse({
    role: getField(formData, "role"),
    canPublish: getField(formData, "canPublish"),
    canExportLeads: getField(formData, "canExportLeads"),
  });
  if (!parsed.success) return;

  try {
    await prisma.$transaction(
      async (tx) => {
        if (membership.role === "ORG_ADMIN" && parsed.data.role !== "ORG_ADMIN") {
          const otherAdmins = await tx.membership.count({
            where: { organizationId: context.organizationId, role: "ORG_ADMIN", id: { not: membershipId } },
          });
          if (otherAdmins === 0) throw new LastAdminError();
        }

        await tx.membership.update({
          where: { id: membershipId },
          data: {
            role: parsed.data.role,
            canPublish: parsed.data.canPublish === "on",
            canExportLeads: parsed.data.canExportLeads === "on",
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof LastAdminError) {
      redirect("/users?error=last_admin");
    }
    throw error;
  }

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "PERMISSION_CHANGE",
    entityType: "Membership",
    entityId: membershipId,
    result: "SUCCESS",
    metadata: { action: "update", roleBefore: membership.role, roleAfter: parsed.data.role },
  });

  revalidatePath("/users");
}

export async function removeMembershipAction(formData: FormData): Promise<void> {
  const context = await requireOrgContext();
  assertCan(context, "user:manage");

  const membershipId = getField(formData, "membershipId");
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, organizationId: context.organizationId },
  });
  if (!membership) notFound();

  try {
    await prisma.$transaction(
      async (tx) => {
        if (membership.role === "ORG_ADMIN") {
          const otherAdmins = await tx.membership.count({
            where: { organizationId: context.organizationId, role: "ORG_ADMIN", id: { not: membershipId } },
          });
          if (otherAdmins === 0) throw new LastAdminError();
        }

        await tx.membership.delete({ where: { id: membershipId } });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof LastAdminError) {
      redirect("/users?error=last_admin");
    }
    throw error;
  }

  await logAudit({
    organizationId: context.organizationId,
    userId: context.userId,
    action: "PERMISSION_CHANGE",
    entityType: "Membership",
    entityId: membershipId,
    result: "SUCCESS",
    metadata: { action: "remove" },
  });

  revalidatePath("/users");
}
