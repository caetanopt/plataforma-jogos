import { NextResponse } from "next/server";
import { requireApiPermission } from "@/server/auth/api-guard";
import { presignUploadUrl } from "@/server/storage/client";
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

  // O URL continua reutilizável até expirar: a confirmação copia o objeto
  // para uma chave definitiva (ver confirmedKeyFor).
  const uploadUrl = await presignUploadUrl(key, contentType, sizeBytes);

  return NextResponse.json({ key, uploadUrl, kind });
}
