import assert from "node:assert/strict";
import { test } from "node:test";
import type { HealthReport } from "../data/health.ts";
import { MENSAGEM_TESTE, autorizado, mensagem, rodarVigia, webhookValido, type VigiaDeps } from "../vigia.ts";

const HOOK = "https://hooks.example.test/services/T000/B000/abc";
const fonte = (f: string, idade: number | null, alerta: number, essencial = true) => ({ fonte: f, nome: f, essencial, ultimoCarimbo: idade === null ? null : "2026-11-13T00:00:00Z", idadeHoras: idade, maxAgeHours: 36, alertaHoras: alerta, estado: "em_dia" as const });
const emDia: HealthReport = { geradoEm: "2026-11-14T00:45:00Z", ok: true, essenciaisComProblema: [], fontes: [fonte("camara", 5, 26), fonte("senado", 6, 26)] };
const parado: HealthReport = { geradoEm: "2026-11-14T00:45:00Z", ok: false, essenciaisComProblema: ["camara", "sapl"], fontes: [fonte("camara", 30.25, 26), fonte("senado", 6, 26), fonte("sapl", null, 192), fonte("tse", 9000, 1440, false)] };

function deps(over: Partial<VigiaDeps> = {}) {
  const enviados: { url: string; text: string }[] = [];
  const d: VigiaDeps = {
    env: { CRON_SECRET: "segredo-de-teste", VIGIA_ALERT_WEBHOOK: HOOK },
    getHealth: async () => emDia,
    post: async (url, text) => {
      enviados.push({ url, text });
      return 200;
    },
    ...over,
  };
  return { d, enviados };
}
const BEARER = "Bearer segredo-de-teste";

test("autorizado: só o Bearer exato; sem segredo configurado ninguém entra", () => {
  assert.equal(autorizado(BEARER, "segredo-de-teste"), true);
  // o cabeçalho inteiro, como a Vercel envia: sem o prefixo, com outro prefixo ou com sobra não entra
  for (const h of ["segredo-de-teste", "bearer segredo-de-teste", "Bearer  segredo-de-teste", "Bearer segredo-de-teste ", "Bearer Bearer segredo-de-teste", "Basic segredo-de-teste"]) assert.equal(autorizado(h, "segredo-de-teste"), false, h);
  // segredo colado com quebra de linha no fim (erro comum): a Vercel envia sem ela e nada autentica; fica documentado na D319
  assert.equal(autorizado(BEARER, "segredo-de-teste\n"), false);
  assert.equal(autorizado("Bearer segredo-de-testE", "segredo-de-teste"), false);
  assert.equal(autorizado("Bearer segredo", "segredo-de-teste"), false);
  assert.equal(autorizado(null, "segredo-de-teste"), false);
  assert.equal(autorizado("Bearer ", undefined), false);
  assert.equal(autorizado("", ""), false);
  assert.equal(autorizado(null, undefined), false);
});

test("webhookValido: só https, sem espaço nem aspas", () => {
  assert.equal(webhookValido(HOOK), true);
  for (const ruim of [undefined, "", "http://hooks.example.test/x", "hooks.example.test/x", "https://a b", 'https://a"b', "https://"]) assert.equal(webhookValido(ruim), false, String(ruim));
});

test("mensagem: null quando tudo em dia; lista só as essenciais com problema; leitura falha tem texto próprio", () => {
  assert.equal(mensagem(emDia), null);
  const m = mensagem(parado)!;
  assert.match(m, /camara: última leitura há 30,3 h \(limite 26 h\)/);
  assert.match(m, /sapl: sem carga/);
  assert.doesNotMatch(m, /senado|tse/);
  assert.match(m, /não depende do GitHub Actions/);
  assert.match(mensagem(null)!, /não foi possível ler os carimbos/);
});

test("sem Bearer certo: 401, nada é lido nem enviado", async () => {
  let leu = false;
  for (const [auth, secret] of [[null, "segredo-de-teste"], ["Bearer errado", "segredo-de-teste"], [BEARER, undefined], ["Bearer ", ""]] as const) {
    const { d, enviados } = deps({ env: { CRON_SECRET: secret, VIGIA_ALERT_WEBHOOK: HOOK }, getHealth: async () => ((leu = true), parado) });
    const r = await rodarVigia(auth, false, d);
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { error: "não autorizado" });
    assert.equal(enviados.length, 0);
  }
  assert.equal(leu, false);
});

test("tudo em dia: 200, sem envio", async () => {
  const { d, enviados } = deps();
  const r = await rodarVigia(BEARER, false, d);
  assert.deepEqual(r, { status: 200, body: { ok: true, essenciaisComProblema: [], alertou: false } });
  assert.equal(enviados.length, 0);
});

test("fonte essencial parada: envia um aviso ao webhook e responde 200", async () => {
  const { d, enviados } = deps({ getHealth: async () => parado });
  const r = await rodarVigia(BEARER, false, d);
  assert.deepEqual(r, { status: 200, body: { ok: false, essenciaisComProblema: ["camara", "sapl"], alertou: true } });
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].url, HOOK);
  assert.match(enviados[0].text, /camara: última leitura/);
});

test("leitura dos carimbos falha (banco fora): também avisa, sem vazar o erro", async () => {
  const { d, enviados } = deps({ getHealth: async () => Promise.reject(new Error("password authentication failed for user web_reader")) });
  const r = await rodarVigia(BEARER, false, d);
  assert.deepEqual(r, { status: 200, body: { ok: false, essenciaisComProblema: null, alertou: true } });
  assert.match(enviados[0].text, /não foi possível ler os carimbos/);
  assert.doesNotMatch(enviados[0].text + JSON.stringify(r.body), /web_reader|password/);
});

test("leitura dos carimbos que não volta (banco travado): estoura o teto e avisa, em vez de morrer calada", async () => {
  const { d, enviados } = deps({ getHealth: () => new Promise(() => {}), leituraMaxMs: 20 });
  const r = await rodarVigia(BEARER, false, d);
  assert.deepEqual(r, { status: 200, body: { ok: false, essenciaisComProblema: null, alertou: true } });
  assert.match(enviados[0].text, /não foi possível ler os carimbos/);
});

test("webhook que responde 3xx (a Vercel e o fetch não seguem como entrega): 502", async () => {
  for (const code of [199, 300, 302]) {
    const { d } = deps({ getHealth: async () => parado, post: async () => code });
    assert.equal((await rodarVigia(BEARER, false, d)).status, 502, String(code));
  }
  const { d } = deps({ getHealth: async () => parado, post: async () => 299 });
  assert.equal((await rodarVigia(BEARER, false, d)).status, 200);
});

test("webhook ausente ou inválido: 500 mesmo com tudo em dia (configuração errada aparece todo dia)", async () => {
  for (const hook of [undefined, "", "http://inseguro.example.test/x"]) {
    for (const saude of [emDia, parado]) {
      const { d, enviados } = deps({ env: { CRON_SECRET: "segredo-de-teste", VIGIA_ALERT_WEBHOOK: hook }, getHealth: async () => saude });
      const r = await rodarVigia(BEARER, false, d);
      assert.equal(r.status, 500);
      assert.equal(r.body.alertou, false);
      assert.equal(enviados.length, 0);
    }
  }
});

test("envio falha: 502, e a URL do webhook nunca aparece no corpo", async () => {
  for (const post of [async () => 404, async () => 500, async () => Promise.reject(new Error(`getaddrinfo ENOTFOUND ${HOOK}`))]) {
    const { d } = deps({ getHealth: async () => parado, post });
    const r = await rodarVigia(BEARER, false, d);
    assert.equal(r.status, 502);
    assert.equal(r.body.alertou, false);
    assert.doesNotMatch(JSON.stringify(r.body), /hooks\.example|services\/T000/);
  }
});

test("?teste=1: envia a mensagem de teste sem ler fonte nenhuma; exige o mesmo Bearer e o webhook", async () => {
  let leu = false;
  const { d, enviados } = deps({ getHealth: async () => ((leu = true), parado) });
  const r = await rodarVigia(BEARER, true, d);
  assert.deepEqual(r, { status: 200, body: { teste: true, alertou: true } });
  assert.equal(leu, false);
  assert.deepEqual(enviados, [{ url: HOOK, text: MENSAGEM_TESTE }]);
  assert.equal((await rodarVigia(null, true, d)).status, 401);
  const sem = deps({ env: { CRON_SECRET: "segredo-de-teste" } });
  assert.equal((await rodarVigia(BEARER, true, sem.d)).status, 500);
});
