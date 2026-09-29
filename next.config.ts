import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O projeto não usa next/image. Com o otimizador desligado, /_next/image
  // deixa de responder — era a origem de três vulnerabilidades do Next
  // (incluindo execução remota de código com AVIF) e ficava ativo sem uso.
  images: {
    unoptimized: true,
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
