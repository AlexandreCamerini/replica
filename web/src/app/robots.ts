import type { MetadataRoute } from "next";
import { robots } from "@/lib/seo";

// Lê SITE_URL a cada requisição (não no build): o build da Vercel roda sem as variáveis de execução.
export const dynamic = "force-dynamic";

export default function Robots(): MetadataRoute.Robots {
  return robots(process.env);
}
