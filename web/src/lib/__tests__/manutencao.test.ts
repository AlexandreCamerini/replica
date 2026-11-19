import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AVISO_MANUTENCAO, emManutencao } from "../manutencao.ts";

test("só MAINTENANCE=1 exato liga a manutenção", () => {
  assert.equal(emManutencao({ MAINTENANCE: "1" }), true);
  for (const v of [undefined, "", "0", "true", " 1", "1 ", "on"]) assert.equal(emManutencao({ MAINTENANCE: v }), false, String(v));
  assert.ok(AVISO_MANUTENCAO.length > 20);
});

test("toda server action de account.ts que escreve recusa na manutenção, antes de qualquer outra instrução", () => {
  const src = readFileSync(new URL("../account.ts", import.meta.url), "utf8");
  const todas = [...src.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
  // signOut fica de fora de propósito: quem quer sair, sai. Ele escreve sessões/tokens (no auth do Supabase, ou em login.sessoes_validas_desde
  // com o pg), e nada disso é copiado no corte (só auth.users), então não há dado perdido; a checagem por atividade ignora essas tabelas.
  const devem = todas.filter((n) => n !== "signOut");
  assert.ok(devem.length >= 6, devem.join(","));
  for (const n of devem) {
    assert.match(src, new RegExp(`export async function ${n}\\(_: FormState, form: FormData\\): Promise<FormState> \\{\\n  const parado = emManutencaoAgora\\(\\);\\n  if \\(parado\\) return parado;`), n);
  }
});

test("o pool de escrita do site só é usado por account.ts, pelos provedores de login e por follows.ts (que só lê): a manutenção cobre todas as escritas", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const raiz = new URL("../../", import.meta.url).pathname;
  const achados: string[] = [];
  const anda = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) {
        if (!/__tests__|\(admin\)|node_modules/.test(p)) anda(p);
      } else if (/\.tsx?$/.test(n) && !/\.admin\./.test(n) && /from "@\/lib\/db\/writer"|from "\.\.?\/.*db\/writer"/.test(readFileSync(p, "utf8"))) achados.push(p.slice(raiz.length));
    }
  };
  anda(raiz);
  assert.deepEqual(achados.sort(), ["lib/account.ts", "lib/auth/dev.ts", "lib/auth/pg.ts", "lib/follows.ts"].sort());
  // follows.ts só faz select (é o "Leituras do usuário"); se um dia escrever, a manutenção precisa cobri-lo
  assert.ok(!/\b(insert|update|delete)\b/i.test(readFileSync(new URL("../follows.ts", import.meta.url), "utf8").replace(/\/\/.*$/gm, "")), "follows.ts passou a escrever");
});
