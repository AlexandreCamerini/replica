// Leitura das preferências do leitor no servidor (cookies sv_uf e sv_esferas). Funções puras e constantes: prefs-shared.ts.
// Ler cookie torna a página dinâmica (o layout raiz já é force-dynamic): é o preço de montar a página com a UF sem JavaScript.
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { data } from "@/lib/data";
import { ESFERAS_COOKIE, ESFERAS_PADRAO, UF_COOKIE, parseCidade, parseEsferas, parseUf, type Prefs } from "./prefs-shared";

export * from "./prefs-shared";

/** UFs válidas do contrato, como {sigla, nome, ibge}, em ordem alfabética do nome. */
export async function ufOptions(): Promise<{ sigla: string; nome: string; ibge: string }[]> {
  const ufs = await data.listUfs();
  return ufs.filter((p) => p.uf).map((p) => ({ sigla: p.uf as string, nome: p.name, ibge: p.ibge }));
}

/**
 * Preferências do leitor. Cookie é dado do usuário: tudo é validado na leitura. Sem cookie de UF, `uf` é null.
 * cache(): layout e página chamam na mesma requisição; `listUfs` roda uma vez só.
 */
export const readPrefs = cache(async function readPrefs(): Promise<Prefs> {
  const jar = await cookies();
  const bruto = jar.get(UF_COOKIE)?.value;
  const opts = await ufOptions().catch(() => null); // null = a lista de UFs não pôde ser lida
  const sigla = parseUf(bruto, (opts ?? []).map((o) => o.sigla));
  const uf = sigla ? ((opts ?? []).find((o) => o.sigla === sigla) ?? null) : null;
  const parsed = parseEsferas(jar.get(ESFERAS_COOKIE)?.value);
  const esferas = parsed ? { ...parsed, cidade: parseCidade(parsed.cidade, uf?.ibge) } : { ...ESFERAS_PADRAO };
  return { uf, esferas, esferasPadrao: !parsed, ufFalhou: opts === null && !!bruto };
});
