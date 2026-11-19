// Prova do login próprio da central contra um Postgres de verdade (D335; migração 0157), com o role `admin_central`.
// Confere o que o teste unitário (persistência em memória) não alcança: os limites decididos pelo SQL de login-store.ts, o gatilho que protege o fator
// verificado e os grants (a central não lê os códigos do site, o site não lê os da central, a central não apaga nada).
//
// Uso (banco DESCARTÁVEL com as migrações até a 0157; a prova escreve e limpa só as próprias linhas):
//   LOGIN_PROVA_URL='postgres://admin_central@localhost:54329/<banco>' node e2e-admin/login-banco.mjs
// Aceita também host de socket: LOGIN_PROVA_HOST=/tmp/claude/pgs LOGIN_PROVA_PORT=54329 LOGIN_PROVA_DB=<banco>
import assert from "node:assert/strict";
import postgres from "postgres";
import { criarLogin } from "../src/lib/admin/login-core.ts";
import { fatorVerificadoDesde, loginStore } from "../src/lib/admin/login-store.ts";
import { hotp, passoDe, deBase32 } from "../src/lib/admin/totp.ts";

const conectar = (usuario) =>
  process.env.LOGIN_PROVA_URL && usuario === "admin_central"
    ? postgres(process.env.LOGIN_PROVA_URL, { max: 2, prepare: false, onnotice: () => {} })
    : postgres({ host: process.env.LOGIN_PROVA_HOST ?? "localhost", port: Number(process.env.LOGIN_PROVA_PORT ?? 5432), database: process.env.LOGIN_PROVA_DB, username: usuario, max: 2, prepare: false, onnotice: () => {} });

const sql = conectar("admin_central");
const ENV = { SESSION_SECRET: "p".repeat(48) };
const A = `prova-${process.pid}@exemplo.org`;
const B = `prova-b-${process.pid}@exemplo.org`;
const N = "a".repeat(32);
const N2 = "b".repeat(32);
// relógio da prova: começa 2 h atrás e só avança (~1 h 20 min no total), para nunca passar do relógio do banco (o gatilho recusa `ultimo_passo` no futuro)
const relogio = { t: Date.now() - 2 * 3600_000 };
const caixa = [];
const login = criarLogin({ store: loginStore(sql), env: ENV, agora: () => relogio.t, enviarEmail: async (_p, c) => (caixa.push(c), true) });
let feitos = 0;
const passo = async (nome, fn) => {
  await fn();
  feitos++;
  console.log(`ok  ${nome}`);
};
const recusa = (p, codigo) => assert.rejects(p, (e) => e.code === codigo, `esperava SQLSTATE ${codigo}`);

try {
  await passo("conecta como admin_central", async () => {
    const [r] = await sql`select current_user as u`;
    assert.equal(r.u, "admin_central");
  });

  await passo("código: 3 envios por hora (o quarto é recusado pelo SQL), 5 tentativas por código, consumo", async () => {
    assert.equal(await login.enviarCodigo(A, N), true);
    const errado = caixa[0] === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) assert.equal(await login.verificarCodigo(A, N, errado), "invalido");
    assert.equal(await login.verificarCodigo(A, N, caixa[0]), "invalido", "sexta tentativa, com o código certo");
    assert.equal(await login.enviarCodigo(A, N), true);
    for (let i = 0; i < 20; i++) assert.equal(await login.verificarCodigo(A, N2, caixa[1]), "invalido", "outro navegador, com o código certo");
    const [t] = await sql`select attempts from login.central_codigos where email = ${A}`;
    assert.equal(t.attempts, 0, "tentativas sem o nonce de quem pediu não contam");
    const dupla = await Promise.all([login.verificarCodigo(A, N, caixa[1]), login.verificarCodigo(A, N, caixa[1])]);
    assert.deepEqual(dupla.sort(), ["invalido", "ok"], "duas verificações simultâneas com o código certo: só uma entra");
    assert.equal(await login.verificarCodigo(A, N, caixa[1]), "invalido", "reuso");
    assert.equal(await login.enviarCodigo(A, N), true);
    assert.equal(await login.enviarCodigo(A, N), false, "quarto envio na hora");
    relogio.t += 3600_000 + 1000;
    assert.equal(await login.enviarCodigo(A, N), true, "a janela de uma hora reabre");
    const [l] = await sql`select code_hash, cardinality(sent_at) as n from login.central_codigos where email = ${A}`;
    assert.ok(/^[0-9a-f]{64}$/.test(l.code_hash) && !caixa.includes(l.code_hash), "o banco guarda o hash");
    assert.equal(l.n, 1, "envios de mais de uma hora saem da linha");
  });

  let segredo;
  await passo("fator: cadastro pendente recomeça; segredo cifrado no banco; verificação marca verificado_em e ultimo_passo", async () => {
    assert.equal(await fatorVerificadoDesde(sql, A), null);
    const um = await login.iniciarCadastro(A);
    const dois = await login.iniciarCadastro(A);
    assert.notEqual(um.segredo, dois.segredo, "recomeçar troca o segredo");
    segredo = deBase32(dois.segredo);
    const [l] = await sql`select segredo_cifrado, verificado_em from login.central_fatores where email = ${A}`;
    assert.ok(!l.segredo_cifrado.includes(dois.segredo) && l.verificado_em === null);
    assert.equal(await login.confirmarFator(A, hotp(deBase32(um.segredo), passoDe(relogio.t))), "invalido", "código do segredo antigo");
    assert.equal(await login.confirmarFator(A, hotp(segredo, passoDe(relogio.t))), "ok");
    const desde = await fatorVerificadoDesde(sql, A);
    assert.equal(desde, Math.floor(relogio.t / 1000), "verificado_em é o instante da verificação, no segundo");
    assert.equal(await login.iniciarCadastro(A), null, "fator verificado não se recadastra");
  });

  await passo("fator: reuso do passo recusado pelo SQL; 5 tentativas por 15 min; sucesso zera", async () => {
    assert.equal(await login.confirmarFator(A, hotp(segredo, passoDe(relogio.t))), "invalido", "mesmo passo");
    assert.equal(await login.confirmarFator(A, hotp(segredo, passoDe(relogio.t) + 1)), "ok", "passo seguinte");
    const errado = hotp(segredo, passoDe(relogio.t) + 500);
    const rajada = await Promise.all(Array.from({ length: 10 }, () => login.confirmarFator(A, errado)));
    assert.deepEqual([rajada.filter((x) => x === "invalido").length, rajada.filter((x) => x === "muitas").length], [5, 5], "dez erradas em paralelo: cinco contam, cinco são barradas");
    relogio.t += 60_000;
    assert.equal(await login.confirmarFator(A, hotp(segredo, passoDe(relogio.t))), "muitas", "sexta na janela, com o código certo");
    relogio.t += 15 * 60_000;
    assert.equal(await login.confirmarFator(A, hotp(segredo, passoDe(relogio.t))), "ok", "a janela reabre");
    const [l] = await sql`select tentativas, tentativas_desde from login.central_fatores where email = ${A}`;
    assert.deepEqual([l.tentativas, l.tentativas_desde], [0, null]);
  });

  await passo("duas verificações simultâneas com o mesmo código: só uma entra", async () => {
    relogio.t += 60_000;
    const c = hotp(segredo, passoDe(relogio.t));
    const r = await Promise.all([login.confirmarFator(A, c), login.confirmarFator(A, c)]);
    assert.deepEqual(r.sort(), ["invalido", "ok"]);
  });

  await passo("gatilho: pela central, fator verificado não troca de segredo, não perde a verificação e não anda para trás", async () => {
    await recusa(sql`update login.central_fatores set segredo_cifrado = 'x' where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set verificado_em = null where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set verificado_em = now() where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set ultimo_passo = ultimo_passo - 1 where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set ultimo_passo = null where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set email = 'outro@exemplo.org' where email = ${A}`, "42501");
    await recusa(sql`insert into login.central_fatores (email, segredo_cifrado) values (${A}, 'y')`, "23505");
    // o que a revisão independente pediu: a central não cria fator já verificado, não joga o passo para o futuro e não mexe em sessoes_desde
    await recusa(sql`insert into login.central_fatores (email, segredo_cifrado, verificado_em) values (${B}, 'lixo', now())`, "42501");
    await recusa(sql`insert into login.central_fatores (email, segredo_cifrado, ultimo_passo) values (${B}, 'lixo', 1)`, "42501");
    await recusa(sql`insert into login.central_fatores (email, segredo_cifrado, sessoes_desde) values (${B}, 'lixo', now())`, "42501");
    await recusa(sql`update login.central_fatores set ultimo_passo = 9223372036854775807 where email = ${A}`, "42501");
    // 0158: a central só ADIANTA sessoes_desde até o relógio do banco ("sair"); nunca atrasa, nunca anula, nunca põe no futuro
    await sql`update login.central_fatores set sessoes_desde = clock_timestamp() where email = ${A}`;
    await recusa(sql`update login.central_fatores set sessoes_desde = clock_timestamp() + interval '1 hour' where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set sessoes_desde = sessoes_desde - interval '1 minute' where email = ${A}`, "42501");
    await recusa(sql`update login.central_fatores set sessoes_desde = null where email = ${A}`, "42501");
    const [c] = await sql`select count(*)::int as n from login.central_fatores where email = ${B}`;
    assert.equal(c.n, 0);
  });

  await passo("grants: a central não apaga, não lê os códigos do site nem as sessões do site, não cria objeto no schema", async () => {
    await recusa(sql`delete from login.central_fatores where email = ${A}`, "42501");
    await recusa(sql`delete from login.central_codigos where email = ${A}`, "42501");
    await recusa(sql`truncate login.central_fatores`, "42501");
    await recusa(sql`select 1 from login.codes limit 1`, "42501");
    await recusa(sql`select 1 from login.sessoes_validas_desde limit 1`, "42501");
    await recusa(sql`create table login.x (a int)`, "42501");
    await recusa(sql`insert into login.central_codigos (email, code_hash, expires_at) values ('MAIUSCULA@exemplo.org', 'h', now())`, "23514");
  });

  if (process.env.LOGIN_PROVA_DB) {
    await passo("grants: os roles do site (web_writer, web_reader) não leem nem gravam as tabelas da central", async () => {
      for (const u of ["web_writer", "web_reader"]) {
        const s = conectar(u);
        try {
          await recusa(s`select 1 from login.central_fatores limit 1`, "42501");
          await recusa(s`select 1 from login.central_codigos limit 1`, "42501");
          await recusa(s`update login.central_fatores set tentativas = 0`, "42501");
        } finally {
          await s.end({ timeout: 1 });
        }
      }
    });
    await passo("dono do banco: apagar o fator derruba a verificação; o cadastro volta a ser possível", async () => {
      const dono = conectar(process.env.LOGIN_PROVA_DONO ?? "postgres");
      try {
        // 0158: desativar o admin revoga as sessões (grava sessoes_desde), reativar não as devolve
        await dono`insert into adm_admins (email, nome) values (${A}, 'Prova') on conflict (email) do nothing`;
        await dono`update login.central_fatores set sessoes_desde = null where email = ${A}`; // o dono zera: só o gatilho pode gravar daqui em diante
        await dono`update adm_admins set ativo = false where email = ${A}`;
        const [s1] = await dono`select sessoes_desde from login.central_fatores where email = ${A}`;
        assert.ok(s1.sessoes_desde, "desativar grava sessoes_desde (gatilho)");
        await dono`update adm_admins set ativo = true where email = ${A}`;
        const [s2] = await dono`select sessoes_desde from login.central_fatores where email = ${A}`;
        assert.equal(+s2.sessoes_desde, +s1.sessoes_desde, "reativar não mexe em sessoes_desde");
        for (const [rotulo, acao] of [
          ["apagar o admin", () => dono`delete from adm_admins where email = ${A}`],
          ["trocar o e-mail do admin", () => dono`update adm_admins set email = ${"outro-" + A} where email = ${A}`],
        ]) {
          await dono`insert into adm_admins (email, nome) values (${A}, 'Prova') on conflict (email) do update set ativo = true`;
          await dono`update login.central_fatores set sessoes_desde = null where email = ${A}`;
          await acao();
          const [x] = await dono`select sessoes_desde from login.central_fatores where email = ${A}`;
          assert.ok(x.sessoes_desde, `${rotulo} revoga as sessões do e-mail antigo`);
          await dono`delete from adm_admins where email in (${A}, ${"outro-" + A})`;
        }
        const antes = await fatorVerificadoDesde(sql, A);
        await dono`update login.central_fatores set sessoes_desde = now() + interval '1 hour' where email = ${A}`;
        assert.ok((await fatorVerificadoDesde(sql, A)) >= Math.floor(Date.now() / 1000) + 3500 && (await fatorVerificadoDesde(sql, A)) > antes, "sessoes_desde, gravado pelo dono, adianta o início de validade das sessões");
        await dono`delete from login.central_fatores where email = ${A}`;
        assert.equal(await fatorVerificadoDesde(sql, A), null);
        assert.ok(await login.iniciarCadastro(A));
        await dono`delete from login.central_fatores where email = ${A}`;
        await dono`delete from login.central_codigos where email = ${A}`;
      } finally {
        await dono.end({ timeout: 1 });
      }
    });
  }
  console.log(`\n${feitos} passos, todos ok`);
} finally {
  await sql.end({ timeout: 1 });
}
