import type { NextConfig } from "next";

function storageHostname(): string | undefined {
  const url = process.env.STORAGE_PUBLIC_URL;
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

const storageHost = storageHostname();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(storageHost
        ? [{ protocol: "http" as const, hostname: storageHost }, { protocol: "https" as const, hostname: storageHost }]
        : []),
      { protocol: "http" as const, hostname: "localhost" },
      { protocol: "http" as const, hostname: "minio" },
    ],
  },
};

export default nextConfig;
