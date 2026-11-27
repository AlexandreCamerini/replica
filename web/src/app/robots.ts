import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { robots } from "@/lib/seo";

// Lê SITE_URL e o host a cada requisição (não no build): o build da Vercel roda sem as variáveis de execução.
// D359: em *.vercel.app (alias de produção e Preview) o robots.txt fecha tudo, mesmo com SITE_URL de produção.
export const dynamic = "force-dynamic";

export default async function Robots(): Promise<MetadataRoute.Robots> {
  const h = await headers();
  return robots(process.env, h.get("x-forwarded-host") ?? h.get("host"));
}
