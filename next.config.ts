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
  async redirects() {
    return [
      // O antigo dashboard foi eliminado: os alertas e as contagens por estado
      // passaram para as estatísticas. Mantém-se o redirect para não partir
      // marcadores e ligações antigas.
      { source: "/dashboard", destination: "/analytics", permanent: false },
    ];
  },
};

export default nextConfig;
