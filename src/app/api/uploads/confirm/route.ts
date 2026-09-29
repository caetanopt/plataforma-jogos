import { NextResponse } from "next/server";
import { requireApiPermission } from "@/server/auth/api-guard";
import { prisma } from "@/server/db/client";
import { headObject, moveObject, publicUrlForKey, readObjectPrefix, StorageError } from "@/server/storage/client";
import {
  classifyMimeType,
  extensionForMimeType,
  MAGIC_BYTES_LENGTH,
  matchesMagicBytes,
  maxBytesFor,
  SVG_MIME_TYPE,
} from "@/lib/security/media-validation";
import { confirmedKeyFor, isUploadKeyOf } from "@/lib/security/upload-keys";
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

  const finalKey = confirmedKeyFor(key);

  // Repetir a confirmação devolve o mesmo registo em vez de criar outro.
  const existing = await prisma.mediaAsset.findFirst({
    where: { organizationId: context.organizationId, storageKey: finalKey },
  });
  if (existing) return NextResponse.json({ id: existing.id, url: existing.url, kind: existing.kind });

  // O objeto tem de existir e ser o que foi declarado — o tamanho, o tipo e
  // os primeiros bytes vêm do storage, não do browser. Depois é copiado para
  // a chave definitiva: o URL de upload ainda permitia escrever por cima.
  try {
    const stored = await headObject(key);
    const storedType = stored?.contentType.split(";")[0]?.trim();
    if (!stored || stored.contentLength !== sizeBytes || storedType !== mimeType) {
      return NextResponse.json({ error: "Upload não encontrado ou diferente do declarado." }, { status: 400 });
    }
    if (!matchesMagicBytes(mimeType, await readObjectPrefix(key, MAGIC_BYTES_LENGTH))) {
      return NextResponse.json({ error: "O conteúdo do ficheiro não corresponde ao tipo." }, { status: 400 });
    }
    await moveObject(key, finalKey, mimeType);
  } catch (error) {
    if (error instanceof StorageError) console.error(`[uploads] ${error.message}`);
    else throw error;
    return NextResponse.json({ error: "Não foi possível confirmar o upload." }, { status: 502 });
  }

  const media = await prisma.mediaAsset.create({
    data: {
      organizationId: context.organizationId,
      uploadedById: context.userId,
      kind,
      storageKey: finalKey,
      // O URL é derivado da chave no servidor; o que o browser mandava era
      // guardado tal como vinha.
      url: publicUrlForKey(finalKey),
      mimeType,
      sizeBytes,
      altText,
    },
  });

  return NextResponse.json({ id: media.id, url: media.url, kind: media.kind });
}
