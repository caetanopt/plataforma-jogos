import { S3Client } from "@aws-sdk/client-s3";

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
