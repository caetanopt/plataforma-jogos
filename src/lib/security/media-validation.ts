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
