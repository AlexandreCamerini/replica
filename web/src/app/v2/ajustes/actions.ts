"use server";

// Ações dos formulários de Ajustes. Funcionam sem JavaScript (POST do <form> + redirect). Só funções async aqui:
// constantes e validação ficam em components/sv/prefs-shared.ts.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ESFERAS_COOKIE, PREFS_MAX_AGE, UF_COOKIE, parseCidade, parseEsferas, parseUf, serializeEsferas, ufOptions, voltarSeguro } from "@/components/sv/prefs";

const COOKIE = { path: "/", maxAge: PREFS_MAX_AGE, sameSite: "lax" as const, httpOnly: true, secure: process.env.NODE_ENV === "production" };

/**
 * Grava a UF (campo `uf`, sigla). Vazio apaga a escolha ("sem estado escolhido"). Sigla fora de `data.listUfs()` é ignorada.
 * Trocar de UF limpa a cidade guardada em sv_esferas. Campo `voltar`: caminho do /v2 para onde voltar.
 */
export async function salvarUf(form: FormData): Promise<void> {
  const jar = await cookies();
  const raw = String(form.get("uf") ?? "").trim();
  const opts = await ufOptions();
  const nova = parseUf(raw, opts.map((o) => o.sigla));
  const atual = parseUf(jar.get(UF_COOKIE)?.value, opts.map((o) => o.sigla));
  if (raw === "") jar.delete(UF_COOKIE);
  else if (nova) jar.set(UF_COOKIE, nova, COOKIE);
  if ((raw === "" || nova) && nova !== atual) {
    const esf = parseEsferas(jar.get(ESFERAS_COOKIE)?.value);
    if (esf?.cidade) jar.set(ESFERAS_COOKIE, serializeEsferas({ ...esf, cidade: null }), COOKIE);
  }
  redirect(voltarSeguro(form.get("voltar")));
}

/**
 * Grava as esferas. Exige o campo oculto `esferas=1` (checkbox desmarcado não vai no POST: sem o marcador, nada muda).
 * `estadual` e `municipal` = checkbox ("on" quando marcado); `cidade` = código IBGE de 7 dígitos da UF escolhida (opcional).
 * O desligado é gravado de forma explícita (e0/m0).
 */
export async function salvarEsferas(form: FormData): Promise<void> {
  const voltar = voltarSeguro(form.get("voltar"));
  if (form.get("esferas") !== "1") redirect(voltar);
  const jar = await cookies();
  const opts = await ufOptions();
  const sigla = parseUf(jar.get(UF_COOKIE)?.value, opts.map((o) => o.sigla));
  const ufIbge = opts.find((o) => o.sigla === sigla)?.ibge ?? null;
  // sem o campo `cidade` no POST, fica a cidade já guardada (se ainda for da UF); campo vazio apaga
  const anterior = parseEsferas(jar.get(ESFERAS_COOKIE)?.value)?.cidade ?? null;
  const cidade = form.has("cidade") ? parseCidade(String(form.get("cidade") ?? ""), ufIbge) : parseCidade(anterior, ufIbge);
  jar.set(ESFERAS_COOKIE, serializeEsferas({ estadual: form.get("estadual") != null, municipal: form.get("municipal") != null, cidade }), COOKIE);
  redirect(voltar);
}
