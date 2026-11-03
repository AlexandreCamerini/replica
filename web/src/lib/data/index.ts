import type { DataSource } from "./types";

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

// Proxy: todas as telas chamam `data.x()`; a implementação resolve uma vez por processo.
export const data: DataSource = new Proxy({} as DataSource, {
  get(_t, prop: keyof DataSource) {
    if (prop === "isDemo") return process.env.DATA_SOURCE !== "pg";
    return async (...args: unknown[]) => {
      const s = await source();
      return (s[prop] as (...a: unknown[]) => unknown)(...args);
    };
  },
});

export * from "./types";
export * from "./types-w4";
