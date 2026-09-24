import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";
import { canRevealSecrets, planSuperAdminPassword } from "./seed-superadmin";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

async function main() {
  const orgSlug = "caetano";
  const superAdminEmail = process.env.SEED_SUPERADMIN_EMAIL ?? "marketing@caetano.pt";
  const canReveal = canRevealSecrets(process.env, process.stdout.isTTY);

  // O plano é decidido antes de qualquer escrita: se for inválido, o seed
  // termina sem deixar a base de dados a meio.
  const existingUser = await prisma.user.findUnique({ where: { email: superAdminEmail } });
  const plan = planSuperAdminPassword({
    userExists: existingUser !== null,
    providedPassword: process.env.SEED_SUPERADMIN_PASSWORD,
    resetRequested: process.env.SEED_SUPERADMIN_RESET_PASSWORD === "true",
    canReveal,
    generatePassword,
  });
  if (plan.kind === "error") {
    console.error(plan.message);
    process.exitCode = 1;
    return;
  }

  const organization = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: {
      name: "Caetano",
      slug: orgSlug,
      privacyContactEmail: "privacidade@caetano.pt",
      defaultTimezone: "Europe/Lisbon",
    },
  });

  const user =
    plan.kind === "create"
      ? await prisma.user.create({
          data: {
            name: "Administrador Caetano",
            email: superAdminEmail,
            passwordHash: await hashPassword(plan.password),
            isSuperAdmin: true,
            emailVerifiedAt: new Date(),
          },
        })
      : existingUser;
  if (!user) throw new Error("Estado inesperado: superadmin inexistente sem plano de criação.");

  if (plan.kind === "reset") {
    const now = new Date();
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(plan.password) },
      }),
      // Um link de recuperação pedido antes da reposição deixa de servir.
      prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: organization.id,
          action: "UPDATE",
          entityType: "User",
          entityId: user.id,
          result: "SUCCESS",
          metadata: { change: "password_reset", source: "seed" },
        },
      }),
    ]);
  }

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
    update: { role: "ORG_ADMIN" },
    create: { userId: user.id, organizationId: organization.id, role: "ORG_ADMIN" },
  });

  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "caetano" } },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Caetano",
      slug: "caetano",
      description: "Espaço de trabalho principal do grupo Caetano.",
    },
  });

  await prisma.folder.upsert({
    where: { id: `${workspace.id}-default` },
    update: {},
    create: {
      id: `${workspace.id}-default`,
      workspaceId: workspace.id,
      name: "Campanhas",
    },
  });

  const brandKitName = "Caetano — Identidade oficial";
  const existingBrandKit = await prisma.campaignTheme.findFirst({
    where: { organizationId: organization.id, isBrandKit: true, name: brandKitName },
  });
  if (!existingBrandKit) {
    await prisma.campaignTheme.create({
      data: {
        organizationId: organization.id,
        name: brandKitName,
        isBrandKit: true,
        primaryColor: "#002E5D",
        secondaryColor: "#00AEEF",
        backgroundColor: "#FFFFFF",
        textColor: "#2E3A46",
        buttonColor: "#00AEEF",
        buttonTextColor: "#FFFFFF",
        fontFamily: "Montserrat",
        borderRadiusPx: 8,
        shadowEnabled: true,
      },
    });
  }

  console.log("Seed concluído.");
  console.log(`Organização: ${organization.name} (${organization.slug})`);
  // O e-mail só aparece num terminal local: em CI o output fica em logs.
  console.log(canReveal ? `Superadmin: ${user.email}` : "Superadmin: configurado.");
  switch (plan.kind) {
    case "create":
      if (plan.reveal) {
        console.log(`Password gerada: ${plan.password}`);
        console.log("Guarde esta password agora — não será mostrada novamente.");
      } else {
        console.log("Superadmin criado com a password de SEED_SUPERADMIN_PASSWORD.");
      }
      break;
    case "reset":
      console.log("Password do superadmin reposta a partir de SEED_SUPERADMIN_PASSWORD.");
      console.log("Links de recuperação pendentes foram invalidados.");
      break;
    case "keep":
      console.log("Utilizador já existia — password não foi alterada.");
      if (process.env.SEED_SUPERADMIN_PASSWORD) {
        console.log("Para a substituir, corra com SEED_SUPERADMIN_RESET_PASSWORD=true.");
      }
      break;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
