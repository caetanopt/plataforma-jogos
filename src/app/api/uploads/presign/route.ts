import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { requireOrgContext } from "@/server/auth/session";
import { s3, MEDIA_BUCKET, publicUrlForKey } from "@/server/storage/client";
import {
  classifyMimeType,
  extensionForMimeType,
  maxBytesFor,
  SVG_MIME_TYPE,
} from "@/lib/security/media-validation";

export async function POST(request: Request) {
  await requireOrgContext();

  const body = await request.json().catch(() => null);
  const contentType = typeof body?.contentType === "string" ? body.contentType : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : 0;

  if (contentType === SVG_MIME_TYPE) {
    return NextResponse.json(
      { error: "SVG deve ser enviado via /api/uploads/svg para sanitização." },
      { status: 400 },
    );
  }

  const kind = classifyMimeType(contentType);
  if (!kind) {
    return NextResponse.json({ error: "Tipo de ficheiro não suportado." }, { status: 400 });
  }
  if (sizeBytes <= 0 || sizeBytes > maxBytesFor(kind)) {
    return NextResponse.json({ error: "Tamanho de ficheiro inválido." }, { status: 400 });
  }

  const key = `uploads/${nanoid()}.${extensionForMimeType(contentType)}`;

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );

  return NextResponse.json({
    key,
    uploadUrl,
    publicUrl: publicUrlForKey(key),
    kind,
  });
}
