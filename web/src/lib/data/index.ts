import { unstable_cache } from "next/cache";
import type { DataSource, Place } from "./types";

// Ponto único de troca. DATA_SOURCE=pg usa o Postgres (web_reader); qualquer outro valor usa a demonstração.
// A escolha é por variável de ambiente para que a demo nunca vá para produção por engano: em produção, DATA_SOURCE=pg é obrigatório.
async function pick(): Promise<DataSource> {
  if (process.env.DATA_SOURCE === "pg") {
    if (!process.env.DATABASE_URL) throw new Error("DATA_SOURCE=pg exige DATABASE_URL");
    return (await import("./pg")).pgSource;
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_DATA !== "1") {
    throw new Error("Em produção, defina DATA_SOURCE=pg (ou ALLOW_DEMO_DATA=1 para uma demo explícita)");
  }
  return (await import("./fake")).fakeSource;
}

// Em produção a escolha é feita uma vez por processo. Em dev não se cacheia: o hot reload trocaria o módulo e a
// instância antiga continuaria respondendo (o pool do Postgres, esse sim, fica cacheado em pg.ts).
const g = globalThis as unknown as { __dataSource?: Promise<DataSource> };
const source = () => (process.env.NODE_ENV === "production" ? (g.__dataSource ??= pick()) : pick());

// Cache de dados (só com DATA_SOURCE=pg). Toda leitura leva a tag `data`, que o ETL invalida no fim de cada run
// (POST /api/revalidate); `ds:<método>`, `person:<id>` e `place:<ibge>` permitem invalidação mais fina.
// O TTL é a rede de segurança: se a revalidação falhar, o dado novo aparece em no máximo uma hora.
// Os argumentos entram na chave do unstable_cache; os retornos são JSON puro (datas como string ISO).
export const CACHE_TTL_S = 3600;
const PERSON_ARG: ReadonlySet<keyof DataSource> = new Set([
  "getMandates",
  "getCandidacies",
  "getStats",
  "getActiveYears",
  "listProposals",
  "listVotes",
  "listExpenses",
  "getLaws",
  "getCommittees",
  "listSpeeches",
  "getContacts",
] as const);

export function cacheTags(prop: keyof DataSource, args: unknown[]): string[] {
  const tags = ["data", `ds:${String(prop)}`];
  const a0 = args[0];
  if (PERSON_ARG.has(prop) && typeof a0 === "string") tags.push(`person:${a0}`);
  if ((prop === "getAgreement" || prop === "getActivity") && Array.isArray(a0)) for (const id of a0) if (typeof id === "string") tags.push(`person:${id}`);
  if ((prop === "getRepresentatives" || prop === "getCoverage") && a0 && typeof a0 === "object") tags.push(`place:${(a0 as Place).ibge}`);
  if (prop === "getPlace" && typeof a0 === "string") tags.push(`place:${a0}`);
  return tags.filter((t) => t.length <= 256).slice(0, 64); // limites do Next por entrada
}

// Proxy: todas as telas chamam `data.x()`; a implementação resolve uma vez por processo.
export const data: DataSource = new Proxy({} as DataSource, {
  get(_t, prop: keyof DataSource) {
    if (prop === "isDemo") return process.env.DATA_SOURCE !== "pg";
    const call = async (...args: unknown[]) => {
      const s = await source();
      return (s[prop] as (...a: unknown[]) => unknown)(...args);
    };
    if (process.env.DATA_SOURCE !== "pg") return call;
    return (...args: unknown[]) =>
      unstable_cache(call, ["data", String(prop)], { tags: cacheTags(prop, args), revalidate: CACHE_TTL_S })(...args);
  },
});

export * from "./types";
