import type { MetadataRoute } from "next";
import { sitemap } from "@/lib/seo";

// Lê SITE_URL a cada requisição (não no build): o build da Vercel roda sem as variáveis de execução.
export const dynamic = "force-dynamic";

export default function Sitemap(): MetadataRoute.Sitemap {
  return sitemap(process.env);
}
