import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { requireApiPermission } from "@/server/auth/api-guard";
import { prisma } from "@/server/db/client";
import { s3, MEDIA_BUCKET, publicUrlForKey, StorageError } from "@/server/storage/client";
import { uploadKeyFor } from "@/lib/security/upload-keys";
import { UPLOAD_PERMISSIONS } from "../permissions";
import { sanitizeSvg } from "@/lib/security/sanitize-svg";
import { MAX_IMAGE_BYTES } from "@/lib/security/media-validation";

export async function POST(request: Request) {
  const access = await requireApiPermission(UPLOAD_PERMISSIONS);
  if (!access.ok) return access.response;
  const { context } = access;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Ficheiro em falta." }, { status: 400 });
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Tamanho de ficheiro inválido." }, { status: 400 });
  }

  const rawSvg = await file.text();
  const sanitized = sanitizeSvg(rawSvg);
  if (!sanitized.includes("<svg")) {
    return NextResponse.json({ error: "Ficheiro SVG inválido." }, { status: 400 });
  }

  const key = uploadKeyFor(context.organizationId, "svg");
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: MEDIA_BUCKET,
        Key: key,
        Body: sanitized,
        ContentType: "image/svg+xml",
      }),
    );
  } catch (error) {
    console.error(`[uploads] ${new StorageError("put", error).message}`);
    return NextResponse.json({ error: "Não foi possível guardar o ficheiro." }, { status: 502 });
  }

  const media = await prisma.mediaAsset.create({
    data: {
      organizationId: context.organizationId,
      uploadedById: context.userId,
      kind: "SVG",
      storageKey: key,
      url: publicUrlForKey(key),
      mimeType: "image/svg+xml",
      sizeBytes: Buffer.byteLength(sanitized),
    },
  });

  return NextResponse.json({ id: media.id, url: media.url, kind: media.kind });
}
