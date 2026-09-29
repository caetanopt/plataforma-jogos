import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireApiPermission } from "@/server/auth/api-guard";
import { s3, MEDIA_BUCKET } from "@/server/storage/client";
import {
  classifyMimeType,
  extensionForMimeType,
  maxBytesFor,
  SVG_MIME_TYPE,
} from "@/lib/security/media-validation";
import { uploadKeyFor } from "@/lib/security/upload-keys";
import { UPLOAD_PERMISSIONS } from "../permissions";

export async function POST(request: Request) {
  const access = await requireApiPermission(UPLOAD_PERMISSIONS);
  if (!access.ok) return access.response;

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
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > maxBytesFor(kind)) {
    return NextResponse.json({ error: "Tamanho de ficheiro inválido." }, { status: 400 });
  }

  const key = uploadKeyFor(access.context.organizationId, extensionForMimeType(contentType));

  // O tipo e o tamanho entram na assinatura: o browser não pode carregar
  // outra coisa (um SVG com script, um ficheiro maior) com este URL.
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
    { expiresIn: 300 },
  );

  return NextResponse.json({ key, uploadUrl, kind });
}
