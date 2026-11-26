"use server";

// Modo leitura fácil (F12): liga ou desliga o cookie sv_facil. Funciona sem JavaScript (POST do <form> + redirect). Só funções async aqui:
// constantes e validação ficam em prefs-shared.ts. O cookie é lido no servidor para montar a página já no modo certo (sem piscar).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FACIL_COOKIE, PREFS_MAX_AGE, voltarSeguro } from "./prefs-shared";

/**
 * `ligar`: "1" liga, qualquer outro valor desliga (o formulário diz o estado que quer, então repetir o POST não inverte de novo).
 * `voltar`: caminho interno para onde voltar (voltarSeguro: sem redirecionamento aberto); sem ele, a raiz.
 */
export async function alternarFacil(form: FormData): Promise<void> {
  const jar = await cookies();
  if (form.get("ligar") === "1") jar.set(FACIL_COOKIE, "1", { path: "/", maxAge: PREFS_MAX_AGE, sameSite: "lax", httpOnly: true, secure: process.env.NODE_ENV === "production" });
  else jar.delete(FACIL_COOKIE);
  redirect(voltarSeguro(form.get("voltar"), "/"));
}
