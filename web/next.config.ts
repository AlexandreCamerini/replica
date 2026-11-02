import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // os testes e2e sobem um servidor próprio sem colidir com o dev server (mesma pasta .next quebra as rotas)
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: { remotePatterns: [{ protocol: "https", hostname: "www.camara.leg.br" }, { protocol: "http", hostname: "www.senado.leg.br" }] },
};

export default nextConfig;
