import QRCode from "qrcode";
import { nanoid } from "nanoid";
import { prisma } from "@/server/db/client";
import { uploadBuffer } from "@/server/storage/client";

export async function generateAndStoreQrCodes(
  organizationId: string,
  uploadedById: string,
  url: string,
): Promise<{ pngMediaId: string; svgMediaId: string }> {
  const [pngBuffer, svgString] = await Promise.all([
    QRCode.toBuffer(url, { type: "png", width: 512, margin: 2 }),
    QRCode.toString(url, { type: "svg", margin: 2 }),
  ]);

  const pngKey = `qr/${nanoid()}.png`;
  const svgKey = `qr/${nanoid()}.svg`;

  const [pngUrl, svgUrl] = await Promise.all([
    uploadBuffer(pngKey, pngBuffer, "image/png"),
    uploadBuffer(svgKey, svgString, "image/svg+xml"),
  ]);

  const [pngMedia, svgMedia] = await Promise.all([
    prisma.mediaAsset.create({
      data: {
        organizationId,
        uploadedById,
        kind: "IMAGE",
        storageKey: pngKey,
        url: pngUrl,
        mimeType: "image/png",
        sizeBytes: pngBuffer.byteLength,
        width: 512,
        height: 512,
      },
    }),
    prisma.mediaAsset.create({
      data: {
        organizationId,
        uploadedById,
        kind: "SVG",
        storageKey: svgKey,
        url: svgUrl,
        mimeType: "image/svg+xml",
        sizeBytes: Buffer.byteLength(svgString),
      },
    }),
  ]);

  return { pngMediaId: pngMedia.id, svgMediaId: svgMedia.id };
}
