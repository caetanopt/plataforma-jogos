import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db/client";
import type { OrgContext } from "@/server/auth/session";

/**
 * Exportação de leads por lotes e em streaming (passo 7): nenhuma linha se
 * perde nem se repete entre lotes, mesmo com datas iguais, e a auditoria
 * regista o que saiu — também quando a transferência é interrompida.
 */

const state = vi.hoisted(() => ({ current: null as OrgContext | null }));
vi.mock("@/server/auth/session", () => ({
  resolveOrgContext: async () =>
    state.current ? { ok: true, context: state.current } : { ok: false, reason: "no_session" },
}));
vi.mock("@/server/auth", () => ({ auth: async () => null }));

const { iterateLeadsForExport } = await import("@/features/leads/queries");
const { resolveDateRange } = await import("@/lib/dates/range");
const exportRoute = await import("@/app/api/leads/export/route");

let organizationId = "";
let campaignId = "";
let userId = "";
const SAME_INSTANT = new Date("2026-07-01T10:00:00Z");

beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8);
  const organization = await prisma.organization.create({ data: { name: `Exp ${suffix}`, slug: `exp-${suffix}` } });
  organizationId = organization.id;
  const user = await prisma.user.create({ data: { name: "T", email: `exp-${suffix}@example.com`, passwordHash: "x" } });
  userId = user.id;
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, role: "ORG_ADMIN" },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: organization.id, name: "Exp", slug: `exp-${suffix}` },
  });
  const campaign = await prisma.campaign.create({
    data: {
      organizationId: organization.id,
      workspaceId: workspace.id,
      type: "MEMORY",
      internalName: "Exportação",
      ownerId: user.id,
      slug: `exp-${suffix}`,
    },
  });
  campaignId = campaign.id;
  const version = await prisma.campaignVersion.create({
    data: { campaignId: campaign.id, versionNumber: 1, snapshot: {}, publishedById: user.id },
  });
  // Sete participações, cinco no mesmo instante: o cursor tem de desempatar.
  await prisma.participation.createMany({
    data: Array.from({ length: 7 }, (_, index) => ({
      campaignId: campaign.id,
      campaignVersionId: version.id,
      idempotencyKey: randomUUID(),
      email: `lead-${index}@example.pt`,
      createdAt: index < 5 ? SAME_INSTANT : new Date(SAME_INSTANT.getTime() + (index - 4) * 60_000),
    })),
  });
  state.current = {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    isSuperAdmin: false,
    organizationId: organization.id,
    membership,
  };
});

afterAll(async () => {
  await prisma.participation.deleteMany({ where: { campaignId } });
  await prisma.campaignVersion.deleteMany({ where: { campaignId } });
  await prisma.campaign.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.membership.deleteMany({ where: { organizationId } });
  await prisma.workspace.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe("exportação por lotes", () => {
  it("lotes de 2: todas as participações, uma vez cada, das mais recentes para as mais antigas", async () => {
    const range = resolveDateRange({ period: "all" });
    const batches: string[][] = [];
    for await (const batch of iterateLeadsForExport(organizationId, range, { campaignId }, 2)) {
      batches.push(batch.map((participation) => participation.email ?? ""));
    }

    expect(batches.map((batch) => batch.length)).toEqual([2, 2, 2, 1]);
    const emails = batches.flat();
    expect(new Set(emails).size).toBe(7);
    // As duas mais recentes primeiro.
    expect(emails.slice(0, 2)).toEqual(["lead-6@example.pt", "lead-5@example.pt"]);
  });

  it("o CSV começa pelo BOM, tem uma linha por participação e fica na auditoria", async () => {
    const response = await exportRoute.GET(
      new Request(`http://localhost:3000/api/leads/export?period=all&campaignId=${campaignId}`),
    );
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const bytes = new Uint8Array(await response.arrayBuffer());

    // O BOM em UTF-8 (o `text()` do fetch retira-o ao descodificar).
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes).split("\n");
    expect(lines[0]!.startsWith("ID,Data,Estado")).toBe(true);
    expect(lines).toHaveLength(8);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { organizationId, action: "EXPORT", result: "SUCCESS", metadata: { path: ["stage"], equals: "completed" } },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({ count: 7 });
  });

  it("a saída fica registada antes do primeiro byte", async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    const response = await exportRoute.GET(
      new Request(`http://localhost:3000/api/leads/export?period=all&campaignId=${campaignId}`),
    );
    // Ainda sem ler o corpo: se o processo morresse agora, o registo existia.
    const started = await prisma.auditLog.findMany({ where: { organizationId, action: "EXPORT" } });
    expect(started.map((audit) => audit.metadata)).toEqual([expect.objectContaining({ stage: "started", count: 0 })]);
    await response.arrayBuffer();
  });

  it("uma linha apagada entre lotes não corta a exportação", async () => {
    const other = await prisma.campaign.create({
      data: {
        organizationId,
        workspaceId: (await prisma.workspace.findFirstOrThrow({ where: { organizationId } })).id,
        type: "MEMORY",
        internalName: "Outra",
        ownerId: userId,
        slug: `exp-outra-${randomUUID().slice(0, 8)}`,
      },
    });
    const otherVersion = await prisma.campaignVersion.create({
      data: { campaignId: other.id, versionNumber: 1, snapshot: {}, publishedById: userId },
    });
    // A linha mais recente é da outra campanha, e sai no primeiro lote.
    const doomed = await prisma.participation.create({
      data: {
        campaignId: other.id,
        campaignVersionId: otherVersion.id,
        idempotencyKey: randomUUID(),
        email: "apagada@example.pt",
        createdAt: new Date(SAME_INSTANT.getTime() + 3_600_000),
      },
    });
    const range = resolveDateRange({ period: "all" });
    const emails: string[] = [];
    try {
      let first = true;
      for await (const batch of iterateLeadsForExport(organizationId, range, {}, 1)) {
        emails.push(...batch.map((participation) => participation.email ?? ""));
        if (first) {
          first = false;
          expect(batch[0]!.id).toBe(doomed.id);
          // A campanha é eliminada enquanto a exportação de todas decorre.
          await prisma.participation.delete({ where: { id: doomed.id } });
        }
      }
    } finally {
      await prisma.participation.deleteMany({ where: { campaignId: other.id } });
      await prisma.campaignVersion.deleteMany({ where: { campaignId: other.id } });
      await prisma.campaign.delete({ where: { id: other.id } });
    }
    // Antes, o lote seguinte ao da linha apagada vinha vazio: saía só ela.
    expect(emails).toHaveLength(8);
    expect(new Set(emails).size).toBe(8);
  });

  it("uma transferência interrompida fica na auditoria como falha", async () => {
    const response = await exportRoute.GET(
      new Request(`http://localhost:3000/api/leads/export?period=all&campaignId=${campaignId}`),
    );
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    const audit = await vi.waitFor(() =>
      prisma.auditLog.findFirstOrThrow({ where: { organizationId, action: "EXPORT", result: "FAILURE" } }),
    );
    expect(audit.metadata).toMatchObject({ reason: "cancelled", count: 0 });
  });

  it("cancelada a meio de um lote: um só registo de falha e nenhum erro no log", async () => {
    await prisma.auditLog.deleteMany({ where: { organizationId } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await exportRoute.GET(
      new Request(`http://localhost:3000/api/leads/export?period=all&campaignId=${campaignId}`),
    );
    const reader = response.body!.getReader();
    await reader.read();
    // O stream já está a ler o lote seguinte para encher a fila.
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const audits = await prisma.auditLog.findMany({ where: { organizationId, action: "EXPORT" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((audit) => [audit.result, (audit.metadata as { stage?: string }).stage])).toEqual([
      ["SUCCESS", "started"],
      ["FAILURE", "interrupted"],
    ]);
    expect(audits[1]!.metadata).toMatchObject({ reason: "cancelled" });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
