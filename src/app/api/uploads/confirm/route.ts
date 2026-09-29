import { NextResponse } from "next/server";
import { requireApiPermission } from "@/server/auth/api-guard";
import { prisma } from "@/server/db/client";
import { headObject, publicUrlForKey, StorageError } from "@/server/storage/client";
import { classifyMimeType, extensionForMimeType, maxBytesFor, SVG_MIME_TYPE } from "@/lib/security/media-validation";
import { isUploadKeyOf } from "@/lib/security/upload-keys";
import { UPLOAD_PERMISSIONS } from "../permissions";

export async function POST(request: Request) {
  const access = await requireApiPermission(UPLOAD_PERMISSIONS);
  if (!access.ok) return access.response;
  const { context } = access;

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : 0;
  const altText = typeof body?.altText === "string" ? body.altText.slice(0, 500) : undefined;

  const kind = classifyMimeType(mimeType);
  if (
    !kind ||
    mimeType === SVG_MIME_TYPE ||
    !isUploadKeyOf(context.organizationId, key, extensionForMimeType(mimeType)) ||
    !Number.isInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > maxBytesFor(kind)
  ) {
    return NextResponse.json({ error: "Dados de upload inválidos." }, { status: 400 });
  }

  // Repetir a confirmação devolve o mesmo registo em vez de criar outro.
  const existing = await prisma.mediaAsset.findFirst({
    where: { organizationId: context.organizationId, storageKey: key },
  });
  if (existing) return NextResponse.json({ id: existing.id, url: existing.url, kind: existing.kind });

  // O objeto tem de existir e ser o que foi declarado — o tamanho e o tipo
  // vêm do storage, não do browser.
  let stored: Awaited<ReturnType<typeof headObject>>;
  try {
    stored = await headObject(key);
  } catch (error) {
    if (error instanceof StorageError) console.error(`[uploads] ${error.message}`);
    return NextResponse.json({ error: "Não foi possível confirmar o upload." }, { status: 502 });
  }
  if (!stored || stored.contentLength !== sizeBytes || stored.contentType.split(";")[0]?.trim() !== mimeType) {
    return NextResponse.json({ error: "Upload não encontrado ou diferente do declarado." }, { status: 400 });
  }

  const media = await prisma.mediaAsset.create({
    data: {
      organizationId: context.organizationId,
      uploadedById: context.userId,
      kind,
      storageKey: key,
      // O URL é derivado da chave no servidor; o que o browser mandava era
      // guardado tal como vinha.
      url: publicUrlForKey(key),
      mimeType,
      sizeBytes,
      altText,
    },
  });

  return NextResponse.json({ id: media.id, url: media.url, kind: media.kind });
}
