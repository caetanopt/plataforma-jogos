import { describe, expect, it } from "vitest";
import { rateLimitRedisKey } from "@/lib/security/rate-limit-key";
import { isUploadKeyOf, uploadKeyFor } from "@/lib/security/upload-keys";
import { firstValues } from "@/lib/forms/search-params";
import { isLiveStatus } from "@/features/campaigns/live-status";

describe("rateLimitRedisKey", () => {
  it("não guarda o identificador em claro, mas mantém o tipo legível", () => {
    const key = rateLimitRedisKey("password-reset:ana@example.com", "segredo");

    expect(key.startsWith("ratelimit:password-reset:")).toBe(true);
    expect(key).not.toContain("ana@example.com");
    expect(key).not.toContain("ana");
  });

  it("é determinística para o mesmo segredo e muda com outro segredo", () => {
    const a = rateLimitRedisKey("login:ana@example.com", "segredo");
    expect(rateLimitRedisKey("login:ana@example.com", "segredo")).toBe(a);
    expect(rateLimitRedisKey("login:ana@example.com", "outro")).not.toBe(a);
    expect(rateLimitRedisKey("login:rui@example.com", "segredo")).not.toBe(a);
  });

  it("identificadores com ':' (ex.: participação:campanha:ip) ficam inteiros no HMAC", () => {
    const key = rateLimitRedisKey("participation:camp1:10.0.0.1", "s");
    expect(key.split(":")).toHaveLength(3);
    expect(key).not.toContain("10.0.0.1");
  });
});

describe("chaves de upload", () => {
  it("aceita só chaves geradas para a mesma organização e extensão", () => {
    const key = uploadKeyFor("org_abc", "png");

    expect(isUploadKeyOf("org_abc", key, "png")).toBe(true);
    expect(isUploadKeyOf("org_outra", key, "png")).toBe(false);
    expect(isUploadKeyOf("org_abc", key, "jpg")).toBe(false);
  });

  it("recusa chaves antigas, de outra pasta ou com caminhos relativos", () => {
    for (const key of [
      "uploads/abcdefghijklmnopqrstu.png",
      "uploads/org_abc/../org_outra/abcdefghijklmnopqrstu.png",
      "outra/org_abc/abcdefghijklmnopqrstu.png",
      "uploads/org_abc/abcdefghijklmnopqrstu.png?x=1",
      "https://evil.example/uploads/org_abc/abcdefghijklmnopqrstu.png",
    ]) {
      expect(isUploadKeyOf("org_abc", key, "png")).toBe(false);
    }
  });

  it("o id da organização é tratado como texto, não como expressão regular", () => {
    const key = uploadKeyFor("org.x", "png");
    expect(isUploadKeyOf("orgYx", key.replace("org.x", "orgYx"), "png")).toBe(true);
    expect(isUploadKeyOf("org.x", key.replace("org.x", "orgYx"), "png")).toBe(false);
  });
});

describe("firstValues", () => {
  it("um parâmetro repetido fica com o primeiro valor", () => {
    expect(firstValues({ search: ["ana", "rui"], page: "2", campaignId: undefined })).toEqual({
      search: "ana",
      page: "2",
      campaignId: undefined,
    });
  });
});

describe("isLiveStatus", () => {
  it("só os estados em que a campanha foi publicada", () => {
    expect(isLiveStatus("PUBLISHED")).toBe(true);
    expect(isLiveStatus("SCHEDULED")).toBe(true);
    expect(isLiveStatus("PAUSED")).toBe(true);
    expect(isLiveStatus("EXPIRED")).toBe(true);
    expect(isLiveStatus("DRAFT")).toBe(false);
    expect(isLiveStatus("ARCHIVED")).toBe(false);
  });
});
