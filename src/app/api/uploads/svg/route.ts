import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { s3, MEDIA_BUCKET, publicUrlForKey } from "@/server/storage/client";
import { sanitizeSvg } from "@/lib/security/sanitize-svg";
import { MAX_IMAGE_BYTES } from "@/lib/security/media-validation";

export async function POST(request: Request) {
  const context = await requireOrgContext();

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

  const key = `uploads/${nanoid()}.svg`;
  await s3.send(
    new PutObjectCommand({
      Bucket: MEDIA_BUCKET,
      Key: key,
      Body: sanitized,
      ContentType: "image/svg+xml",
    }),
  );

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
