"use server";

import { cookies, headers } from "next/headers";
import { FOLLOW_COOKIE, FOLLOW_MAX, FOLLOW_PATH, parseFollows, serializeFollows, slugValido } from "./follow-shared";

/**
 * Marca (`acao=incluir`) ou desmarca (`acao=remover`) uma pessoa em "em quem eu votei" (campo `slug`). A lista é gravada
 * pelo servidor com `httpOnly`: nenhum script da página, nosso ou de terceiro, consegue ler em quem a pessoa diz ter
 * votado (D317). A action recebe a intenção, não alterna: clique duplo, reenvio do formulário ou outra aba com o estado
 * antigo não invertem o que a pessoa pediu.
 * Slug ou ação fora do padrão são ignorados; com a lista cheia, incluir não muda nada. Regrava mesmo sem mudança, para que
 * um cookie antigo (gravado pelo navegador, legível por script) passe a ser `httpOnly` no primeiro toque.
 * A action não lê banco: slug que não existe é ignorado por quem monta as páginas.
 */
export async function alternarEscolhido(form: FormData): Promise<void> {
  const slug = String(form.get("slug") ?? "");
  const acao = String(form.get("acao") ?? "");
  if (!slugValido(slug) || (acao !== "incluir" && acao !== "remover")) return;
  const jar = await cookies();
  const atual = parseFollows(jar.get(FOLLOW_COOKIE)?.value);
  const nova = acao === "remover" ? atual.filter((s) => s !== slug) : atual.includes(slug) || atual.length >= FOLLOW_MAX ? atual : [...atual, slug];
  // `Secure` segue o protocolo da requisição (na Vercel, x-forwarded-proto=https), como na rota /v2: navegador que não
  // trata http://localhost como seguro descartaria um cookie `Secure` sem avisar. Sem o cabeçalho, produção vale https.
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0].trim();
  const secure = proto ? proto === "https" : process.env.NODE_ENV === "production";
  const opcoes = { path: FOLLOW_PATH, sameSite: "lax" as const, httpOnly: true, secure };
  if (nova.length > 0) jar.set(FOLLOW_COOKIE, serializeFollows(nova), { ...opcoes, maxAge: 31536000 });
  else jar.set(FOLLOW_COOKIE, "", { ...opcoes, maxAge: 0 });
}
