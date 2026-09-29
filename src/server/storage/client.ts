import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

declare global {
  var __s3: S3Client | undefined;
}

function createS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? "us-east-1",
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
    },
    // Versões recentes do SDK calculam por omissão um checksum adicional
    // (CRC32) em cada upload — a maioria dos serviços compatíveis com S3
    // (secção 28: "storage compatível com S3") ainda não o suporta e
    // rejeita o pedido. "WHEN_REQUIRED" mantém o checksum apenas quando a
    // operação o exige mesmo, restaurando a compatibilidade.
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
}

export const s3 = globalThis.__s3 ?? createS3Client();

if (process.env.NODE_ENV !== "production") {
  globalThis.__s3 = s3;
}

export const MEDIA_BUCKET = process.env.STORAGE_BUCKET ?? "plataforma-jogos-media";

export function publicUrlForKey(key: string): string {
  const base = process.env.STORAGE_PUBLIC_URL ?? "";
  return `${base.replace(/\/$/, "")}/${key}`;
}

/**
 * Erro do storage sem os detalhes do SDK. Os erros do S3/R2 trazem o
 * AWSAccessKeyId, o StringToSign, o pedido canónico (bucket, chave,
 * cabeçalhos) e os ids do pedido — e o Next imprime o erro inteiro nos logs.
 * Fica só o nome e o estado HTTP.
 */
export class StorageError extends Error {
  constructor(operation: string, cause: unknown) {
    const name = (cause as { name?: string })?.name ?? "Error";
    const status = (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    super(`Falha no armazenamento (${operation}: ${name}${status ? ` ${status}` : ""})`);
    this.name = "StorageError";
  }
}

export async function uploadBuffer(key: string, body: Buffer | string, contentType: string): Promise<string> {
  try {
    await s3.send(new PutObjectCommand({ Bucket: MEDIA_BUCKET, Key: key, Body: body, ContentType: contentType }));
  } catch (error) {
    throw new StorageError("put", error);
  }
  return publicUrlForKey(key);
}

/** Metadados de um objeto já carregado, ou null se não existir. */
export async function headObject(key: string): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: key }));
    return { contentLength: head.ContentLength ?? -1, contentType: head.ContentType ?? "" };
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string })?.name === "NotFound") return null;
    throw new StorageError("head", error);
  }
}
