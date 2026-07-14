import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/security/password";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function generatePassword(): string {
  return randomBytes(12).toString("base64url");
}

async function main() {
  const orgSlug = "caetano";
  const superAdminEmail = process.env.SEED_SUPERADMIN_EMAIL ?? "marketing@caetano.pt";
  const superAdminPassword = process.env.SEED_SUPERADMIN_PASSWORD ?? generatePassword();

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

  const existingUser = await prisma.user.findUnique({ where: { email: superAdminEmail } });
  const user = existingUser
    ? existingUser
    : await prisma.user.create({
        data: {
          name: "Administrador Caetano",
          email: superAdminEmail,
          passwordHash: await hashPassword(superAdminPassword),
          isSuperAdmin: true,
          emailVerifiedAt: new Date(),
        },
      });

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
  console.log(`Superadmin: ${user.email}`);
  if (!existingUser) {
    console.log(`Password gerada: ${superAdminPassword}`);
    console.log("Guarde esta password agora — não será mostrada novamente.");
  } else {
    console.log("Utilizador já existia — password não foi alterada.");
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
