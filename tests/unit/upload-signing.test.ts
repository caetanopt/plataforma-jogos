import { beforeAll, describe, expect, it } from "vitest";
import { matchesMagicBytes } from "@/lib/security/media-validation";
import { confirmedKeyFor, uploadKeyFor } from "@/lib/security/upload-keys";

describe("URL de upload assinado", () => {
  let presignUploadUrl: (key: string, contentType: string, size: number) => Promise<string>;

  beforeAll(async () => {
    process.env.STORAGE_ENDPOINT = "http://localhost:9000";
    process.env.STORAGE_ACCESS_KEY_ID = "teste";
    process.env.STORAGE_SECRET_ACCESS_KEY = "teste";
    process.env.STORAGE_FORCE_PATH_STYLE = "true";
    ({ presignUploadUrl } = await import("@/server/storage/client"));
  });

  it("assina o tipo e o tamanho — o presigner do SDK deixava o content-type de fora", async () => {
    const url = new URL(await presignUploadUrl("uploads/org/abc.png", "image/png", 1234));
    const signed = url.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];

    expect(signed).toContain("content-type");
    expect(signed).toContain("content-length");
  });
});

describe("matchesMagicBytes", () => {
  const bytes = (values: number[] | string) =>
    typeof values === "string" ? new TextEncoder().encode(values) : new Uint8Array(values);

  it("reconhece cada tipo aceite pelo conteúdo", () => {
    expect(matchesMagicBytes("image/png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesMagicBytes("image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesMagicBytes("image/gif", bytes("GIF89a"))).toBe(true);
    expect(matchesMagicBytes("image/webp", bytes("RIFF\u0000\u0000\u0000\u0000WEBP"))).toBe(true);
    expect(matchesMagicBytes("video/mp4", bytes("\u0000\u0000\u0000\u0018ftypmp42"))).toBe(true);
  });

  it("recusa HTML/SVG com o nome ou o tipo de uma imagem", () => {
    expect(matchesMagicBytes("image/png", bytes("<svg onload=alert(1)>"))).toBe(false);
    expect(matchesMagicBytes("image/jpeg", bytes("<!doctype html>"))).toBe(false);
    expect(matchesMagicBytes("image/svg+xml", bytes("<svg>"))).toBe(false);
  });
});

describe("chave definitiva", () => {
  it("passa de uploads/ para media/, fora do alcance de qualquer URL de upload", () => {
    const key = uploadKeyFor("org_1", "png");
    expect(confirmedKeyFor(key)).toBe(key.replace("uploads/", "media/"));
  });
});
