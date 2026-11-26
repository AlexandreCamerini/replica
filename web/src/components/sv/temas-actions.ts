"use server";

// Escolha de assuntos (F5): grava ou apaga o cookie sv_temas. Funciona sem JavaScript (POST do <form> + redirect). Só funções async aqui:
// constantes e validação ficam em temas-escolhidos.ts.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { data } from "@/lib/data";
import { PREFS_MAX_AGE, voltarSeguro } from "./prefs-shared";
import { TEMAS_COOKIE, parseTemas, serializeTemas } from "./temas-escolhidos";

/**
 * Campos: `tema` (um por assunto marcado; vale só o que existe em `data.listTopics()`, até TEMAS_MAX), `acao=limpar` (apaga a escolha) e
 * `voltar` (caminho interno; voltarSeguro, sem redirecionamento aberto). Se a lista de assuntos não puder ser lida, nada é gravado.
 * O `redirect` fica FORA do try: ele lança e não pode ser engolido.
 */
export async function salvarTemas(form: FormData): Promise<void> {
  const voltar = voltarSeguro(form.get("voltar"), "/votacoes");
  const jar = await cookies();
  if (form.get("acao") === "limpar") {
    jar.delete(TEMAS_COOKIE);
    redirect(voltar);
  }
  let validos: string[] | null = null;
  try {
    validos = (await data.listTopics()).map((t) => t.slug);
  } catch (e) {
    console.error("temas: a lista de assuntos não pôde ser lida", e);
  }
  if (!validos) redirect(voltar); // banco fora: nada gravado
  const escolhidos = parseTemas(form.getAll("tema").map(String), validos);
  if (escolhidos.length === 0) jar.delete(TEMAS_COOKIE);
  else jar.set(TEMAS_COOKIE, serializeTemas(escolhidos), { path: "/", maxAge: PREFS_MAX_AGE, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  redirect(voltar);
}
