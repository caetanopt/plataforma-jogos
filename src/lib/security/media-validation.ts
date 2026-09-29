import type { MediaKind } from "@/generated/prisma/client";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
export const VIDEO_MIME_TYPES = ["video/mp4"];
export const SVG_MIME_TYPE = "image/svg+xml";

export function classifyMimeType(mimeType: string): MediaKind | null {
  if (IMAGE_MIME_TYPES.includes(mimeType)) return "IMAGE";
  if (VIDEO_MIME_TYPES.includes(mimeType)) return "VIDEO";
  if (mimeType === SVG_MIME_TYPE) return "SVG";
  return null;
}

export function maxBytesFor(kind: MediaKind): number {
  return kind === "VIDEO" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "video/mp4":
      return "mp4";
    case SVG_MIME_TYPE:
      return "svg";
    default:
      return "bin";
  }
}

/**
 * Confirma o tipo pelo conteúdo (secção 9: "validar MIME, tamanho e
 * conteúdo"). O Content-Type declarado não chega: é o browser que o escolhe.
 */
export function matchesMagicBytes(mimeType: string, bytes: Uint8Array): boolean {
  const at = (offset: number, expected: number[]) => expected.every((byte, i) => bytes[offset + i] === byte);
  const ascii = (offset: number, text: string) => at(offset, [...text].map((c) => c.charCodeAt(0)));
  switch (mimeType) {
    case "image/png":
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return at(0, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "video/mp4":
      return ascii(4, "ftyp");
    default:
      return false;
  }
}

/** Bytes a ler para `matchesMagicBytes`. */
export const MAGIC_BYTES_LENGTH = 16;
