import { NextResponse, type NextRequest } from "next/server";
import { FOLLOW_COOKIE, FOLLOW_PATH, FOLLOW_PATH_ANTIGO, parseFollows, serializeFollows } from "@/components/sv/follow-shared";

// A Direção 2 viveu em /v2 até a D316. Quem guardou um endereço de lá chega ao mesmo lugar na raiz, com a consulta.
// 307, não 308: redirecionamento temporário não fica gravado no navegador e pode ser desfeito num deploy.
// O cookie de escolhidos do protótipo valia só em /v2: aqui ele é juntado à lista da raiz (se houver) e a cópia antiga é apagada.
export const dynamic = "force-dynamic";

function todos(req: NextRequest): string[] {
  const raw = req.headers.get("cookie") ?? "";
  return raw.split(/;\s*/).filter((c) => c.startsWith(`${FOLLOW_COOKIE}=`)).map((c) => c.slice(FOLLOW_COOKIE.length + 1));
}

async function levar(req: NextRequest, ctx: { params: Promise<{ resto?: string[] }> }) {
  const resto = (await ctx.params).resto ?? [];
  const destino = req.nextUrl.clone();
  // só o caminho muda: a origem é a da própria requisição (sem redirecionamento aberto)
  destino.pathname = `/${resto.map(encodeURIComponent).join("/")}`;
  const res = NextResponse.redirect(destino, 307);
  const valores = todos(req);
  if (valores.length > 0) {
    const fim = `; HttpOnly; SameSite=Lax${req.nextUrl.protocol === "https:" ? "; Secure" : ""}`;
    // O navegador manda as duas cópias (a de /v2, caminho mais específico, vem primeiro). Junta as duas sem repetir,
    // a da raiz na frente, até o teto: nenhuma escolha some por causa da ordem em que a pessoa visitou as páginas.
    const lista = parseFollows([...valores].reverse().flatMap((v) => parseFollows(v)).join("."));
    // dois Set-Cookie com o mesmo nome e caminhos diferentes: res.cookies guarda um por nome, por isso vão direto no cabeçalho.
    // O valor só tem slugs ([a-z0-9-]) separados por ponto: não precisa de codificação.
    res.headers.append("Set-Cookie", `${FOLLOW_COOKIE}=; Path=${FOLLOW_PATH_ANTIGO}; Max-Age=0${fim}`);
    if (lista.length > 0) res.headers.append("Set-Cookie", `${FOLLOW_COOKIE}=${serializeFollows(lista)}; Path=${FOLLOW_PATH}; Max-Age=31536000${fim}`);
  }
  return res;
}

export const GET = levar;
export const HEAD = levar;
