import { NextResponse } from "next/server";
import { requireOrgContext } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { classifyMimeType, maxBytesFor } from "@/lib/security/media-validation";

export async function POST(request: Request) {
  const context = await requireOrgContext();
  const body = await request.json().catch(() => null);

  const key = typeof body?.key === "string" ? body.key : "";
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : 0;
  const publicUrl = typeof body?.publicUrl === "string" ? body.publicUrl : "";
  const altText = typeof body?.altText === "string" ? body.altText : undefined;

  const kind = classifyMimeType(mimeType);
  if (!key || !kind || !publicUrl || sizeBytes <= 0 || sizeBytes > maxBytesFor(kind)) {
    return NextResponse.json({ error: "Dados de upload inválidos." }, { status: 400 });
  }

  const media = await prisma.mediaAsset.create({
    data: {
      organizationId: context.organizationId,
      uploadedById: context.userId,
      kind,
      storageKey: key,
      url: publicUrl,
      mimeType,
      sizeBytes,
      altText,
    },
  });

  return NextResponse.json({ id: media.id, url: media.url, kind: media.kind });
}
