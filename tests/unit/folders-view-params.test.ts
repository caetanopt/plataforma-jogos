import { describe, expect, it } from "vitest";
import {
  FOLDER_SORT_ORDER_BY,
  foldersUrl,
  parseFolderSort,
  parseFolderTab,
} from "@/features/folders/view-params";
import { getGreeting, getGreetingName } from "@/lib/dates/greeting";

describe("parseFolderTab", () => {
  it("aceita os separadores conhecidos", () => {
    expect(parseFolderTab("ativas")).toBe("ativas");
    expect(parseFolderTab("arquivadas")).toBe("arquivadas");
  });

  it("degrada para 'ativas' perante valores forjados", () => {
    expect(parseFolderTab("../../etc/passwd")).toBe("ativas");
    expect(parseFolderTab(undefined)).toBe("ativas");
    expect(parseFolderTab(null)).toBe("ativas");
    expect(parseFolderTab({ name: "desc" })).toBe("ativas");
  });
});

describe("parseFolderSort", () => {
  it("aceita as ordenações conhecidas", () => {
    expect(parseFolderSort("apps_desc")).toBe("apps_desc");
    expect(parseFolderSort("recent")).toBe("recent");
  });

  it("degrada para 'name_asc' perante valores forjados", () => {
    expect(parseFolderSort("createdAt")).toBe("name_asc");
    expect(parseFolderSort(undefined)).toBe("name_asc");
  });

  it("todas as ordenações válidas têm um orderBy do Prisma", () => {
    for (const key of ["name_asc", "name_desc", "recent", "apps_desc"] as const) {
      expect(FOLDER_SORT_ORDER_BY[key]).toBeDefined();
    }
  });
});

describe("foldersUrl", () => {
  it("omite os valores por omissão", () => {
    expect(foldersUrl()).toBe("/folders");
    expect(foldersUrl({ tab: "ativas", sort: "name_asc" })).toBe("/folders");
  });

  it("preserva separador e ordenação", () => {
    expect(foldersUrl({ tab: "arquivadas", sort: "recent" })).toBe(
      "/folders?tab=arquivadas&sort=recent",
    );
  });

  it("nunca produz um destino fora de /folders, mesmo com valores forjados", () => {
    // Defesa contra open redirect: o `tab`/`sort` chega do FormData.
    const forged = foldersUrl({ tab: "https://exemplo.invalid", sort: "//evil.test" });
    expect(forged).toBe("/folders");
    expect(foldersUrl({ tab: "arquivadas", error: "not_found" })).toBe(
      "/folders?tab=arquivadas&error=not_found",
    );
  });
});

describe("getGreeting", () => {
  // Datas em UTC; Europe/Lisbon está em UTC+1 em setembro (horário de verão).
  it("varia com a hora do dia no fuso de referência", () => {
    expect(getGreeting(new Date("2026-09-21T08:00:00Z"))).toBe("Bom dia");
    expect(getGreeting(new Date("2026-09-21T15:00:00Z"))).toBe("Boa tarde");
    expect(getGreeting(new Date("2026-09-21T21:00:00Z"))).toBe("Boa noite");
    expect(getGreeting(new Date("2026-09-21T02:00:00Z"))).toBe("Boa noite");
  });

  it("respeita o fuso passado", () => {
    // 22:00 UTC = 23:00 em Lisboa (UTC+1 em setembro) e 19:00 em São Paulo.
    const instant = new Date("2026-09-21T22:00:00Z");
    expect(getGreeting(instant, "Europe/Lisbon")).toBe("Boa noite");
    expect(getGreeting(instant, "America/Sao_Paulo")).toBe("Boa tarde");
  });
});

describe("getGreetingName", () => {
  it("usa o primeiro nome", () => {
    expect(getGreetingName("Daniel Ferreira Costa")).toBe("Daniel");
  });

  it("não expõe o e-mail quando o utilizador não tem nome", () => {
    expect(getGreetingName("marketing@caetano.pt")).toBeNull();
    expect(getGreetingName("")).toBeNull();
    expect(getGreetingName("   ")).toBeNull();
  });
});
