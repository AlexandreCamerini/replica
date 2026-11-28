import assert from "node:assert/strict";
import test from "node:test";
import { criarLogin, ENVIOS_POR_HORA, ipDoPedido, JANELA_DO_FATOR_MS, ORIGEM_POR_HORA, TENTATIVAS_DO_CODIGO, TENTATIVAS_DO_FATOR, type LinhaFator, type LoginStore } from "../admin/login-core.ts";
import { assinarSessao, chaveDaCentral, cifrarSegredo, decifrarSegredo, hashDaOrigem, hashDoCodigo, hashDoNonce, lerSessao, VALIDADE_S } from "../admin/sessao-cookie.ts";
import { conferirTotp, deBase32, hotp, paraBase32, passoDe, uriOtpauth } from "../admin/totp.ts";

// D335: login próprio da central (código por e-mail + TOTP + cookie assinado). Tudo puro: nenhum teste toca banco, rede ou Next.

const ENV = { SESSION_SECRET: "s".repeat(48) };
const SEMENTE = Buffer.from("12345678901234567890"); // segredo dos vetores das RFCs 4226 e 6238

test("HOTP: vetores do apêndice D da RFC 4226", () => {
  const esperado = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  esperado.forEach((v, i) => assert.equal(hotp(SEMENTE, i), v, `contador ${i}`));
});

test("TOTP: vetores SHA-1 do apêndice B da RFC 6238 (8 dígitos) e os 6 dígitos finais de cada um", () => {
  const vetores: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [t, v] of vetores) {
    assert.equal(hotp(SEMENTE, passoDe(t * 1000), 8), v, `t=${t}`);
    assert.equal(hotp(SEMENTE, passoDe(t * 1000)), v.slice(2), `t=${t}, 6 dígitos`);
  }
});

test("base32: vetores da RFC 4648, ida e volta, e recusa de caractere fora do alfabeto", () => {
  const pares: [string, string][] = [["f", "MY"], ["fo", "MZXQ"], ["foo", "MZXW6"], ["foob", "MZXW6YQ"], ["fooba", "MZXW6YTB"], ["foobar", "MZXW6YTBOI"]];
  for (const [claro, b32] of pares) {
    assert.equal(paraBase32(Buffer.from(claro)), b32);
    assert.equal(deBase32(b32)?.toString(), claro);
  }
  assert.equal(deBase32("mzxw 6ytb-oi==")?.toString(), "foobar", "caixa, espaço, hífen e = são tolerados");
  assert.equal(deBase32("MZXW1"), null, "1 não é do alfabeto");
  assert.equal(deBase32(""), null);
  assert.equal(paraBase32(SEMENTE), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
});

test("conferirTotp: janela de um passo para cada lado, nada fora dela, formato estrito e sem reuso", () => {
  const t = 1_700_000_000_000;
  const p = passoDe(t);
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p), t, null), p);
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p - 1), t, null), p - 1, "passo anterior (relógio atrasado)");
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p + 1), t, null), p + 1, "passo seguinte (relógio adiantado)");
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p - 2), t, null), null);
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p + 2), t, null), null);
  for (const ruim of ["", "12345", "1234567", "12345a", " 123456", "１２３４５６"]) assert.equal(conferirTotp(SEMENTE, ruim, t, null), null, JSON.stringify(ruim));
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p), t, p), null, "o mesmo passo não vale duas vezes");
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p - 1), t, p), null, "passo anterior ao último aceito não vale");
  assert.equal(conferirTotp(SEMENTE, hotp(SEMENTE, p + 1), t, p), p + 1);
});

test("uriOtpauth: rótulo e emissor escapados, parâmetros que o autenticador espera", () => {
  const u = uriOtpauth("ABCD", "a+b@exemplo.org", "Segue o Voto (central)");
  assert.equal(u, "otpauth://totp/Segue%20o%20Voto%20(central):a%2Bb%40exemplo.org?secret=ABCD&issuer=Segue%20o%20Voto%20(central)&algorithm=SHA1&digits=6&period=30");
});

test("chaves por uso são diferentes entre si e exigem SESSION_SECRET de 32+ caracteres", () => {
  const [a, b, c] = (["cookie", "codigo", "fator"] as const).map((u) => chaveDaCentral(ENV, u).toString("hex"));
  assert.ok(a !== b && b !== c && a !== c);
  for (const s of [undefined, "", "curto", "x".repeat(31)]) assert.throws(() => chaveDaCentral({ SESSION_SECRET: s }, "cookie"), /SESSION_SECRET/);
});

test("cookie de sessão: ida e volta nos dois níveis; vencido, adulterado, de outro segredo ou malformado = null", () => {
  const t = 1_700_000_000_000;
  for (const nivel of [1, 2] as const) {
    const { valor, maxAgeS } = assinarSessao(ENV, "a@exemplo.org", nivel, t);
    assert.equal(maxAgeS, VALIDADE_S[nivel]);
    assert.deepEqual(lerSessao(ENV, valor, t + 1000), { email: "a@exemplo.org", nivel, iat: t / 1000 });
    assert.equal(lerSessao(ENV, valor, t + maxAgeS * 1000), null, "no instante do vencimento já não vale");
    assert.ok(lerSessao(ENV, valor, t + maxAgeS * 1000 - 1000));
    assert.equal(lerSessao({ SESSION_SECRET: "t".repeat(48) }, valor, t), null, "outro segredo");
    const [corpo, sig] = valor.split(".");
    assert.equal(lerSessao(ENV, `${corpo}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`, t), null, "assinatura adulterada");
    assert.equal(lerSessao(ENV, `${corpo}x.${sig}`, t), null, "corpo adulterado");
    assert.equal(lerSessao(ENV, `${valor}.x`, t), null, "terceira parte");
  }
  for (const v of [undefined, "", ".", "a.", ".b", "a.b", "x".repeat(2000)]) assert.equal(lerSessao(ENV, v, t), null, String(v).slice(0, 12));
});

test("cookie de sessão: nível 1 não vira nível 2 trocando o corpo, e validade maior que a do nível é recusada mesmo com assinatura certa", async () => {
  const t = 1_700_000_000_000;
  const { createHmac } = await import("node:crypto");
  const forjar = (obj: Record<string, unknown>): string => {
    const corpo = Buffer.from(JSON.stringify(obj)).toString("base64url");
    return `${corpo}.${createHmac("sha256", chaveDaCentral(ENV, "cookie")).update(corpo).digest("base64url")}`;
  };
  const iat = t / 1000;
  assert.ok(lerSessao(ENV, forjar({ e: "a@exemplo.org", n: 2, iat, exp: iat + VALIDADE_S[2] }), t), "controle: o forjador com a chave certa produz cookie válido");
  assert.equal(lerSessao(ENV, forjar({ e: "a@exemplo.org", n: 1, iat, exp: iat + VALIDADE_S[2] }), t), null, "nível 1 com validade de nível 2");
  assert.equal(lerSessao(ENV, forjar({ e: "a@exemplo.org", n: 3, iat, exp: iat + 900 }), t), null, "nível desconhecido");
  assert.equal(lerSessao(ENV, forjar({ e: "A@exemplo.org", n: 2, iat, exp: iat + VALIDADE_S[2] }), t), null, "e-mail com maiúscula");
  assert.equal(lerSessao(ENV, forjar({ e: "sem-arroba", n: 2, iat, exp: iat + VALIDADE_S[2] }), t), null);
  assert.equal(lerSessao(ENV, forjar({ e: "a@exemplo.org", n: 2, iat: iat + 3600, exp: iat + 3600 + VALIDADE_S[2] }), t), null, "emitido no futuro");
  // a chave do cookie não é a do código: um hash de código nunca serve de assinatura
  const corpo = Buffer.from(JSON.stringify({ e: "a@exemplo.org", n: 2, iat, exp: iat + VALIDADE_S[2] })).toString("base64url");
  assert.equal(lerSessao(ENV, `${corpo}.${createHmac("sha256", chaveDaCentral(ENV, "codigo")).update(corpo).digest("base64url")}`, t), null);
});

test("segredo do fator: cifra com IV novo a cada vez, abre só com o mesmo e-mail e o mesmo SESSION_SECRET", () => {
  const a = cifrarSegredo(ENV, "a@exemplo.org", SEMENTE);
  const b = cifrarSegredo(ENV, "a@exemplo.org", SEMENTE);
  assert.notEqual(a, b);
  assert.ok(!a.includes(paraBase32(SEMENTE)) && !Buffer.from(a, "base64url").includes(SEMENTE), "o segredo não aparece em claro");
  assert.deepEqual(decifrarSegredo(ENV, "a@exemplo.org", a), SEMENTE);
  assert.equal(decifrarSegredo(ENV, "b@exemplo.org", a), null, "linha copiada para outro admin");
  assert.equal(decifrarSegredo({ SESSION_SECRET: "t".repeat(48) }, "a@exemplo.org", a), null);
  assert.equal(decifrarSegredo(ENV, "a@exemplo.org", `${a.slice(0, -2)}AA`), null, "texto adulterado");
  assert.equal(decifrarSegredo(ENV, "a@exemplo.org", ""), null);
});

// ---- núcleo, com persistência em memória que imita as regras atômicas do banco (login-store.ts)
function memoria() {
  const codigos = new Map<string, { hash: string; nonceHash: string; expiraMs: number; tentativas: number; envios: number[] }>();
  const fatores = new Map<string, LinhaFator & { tentativas: number; desde: number | null }>();
  const origens: { origemHash: string; t: number }[] = [];
  const store: LoginStore = {
    async emitirCodigo(email, hash, nonceHash, agora, origemHash) {
      const c = codigos.get(email);
      const envios = (c?.envios ?? []).filter((t) => t > agora - 3600_000);
      if (envios.length >= ENVIOS_POR_HORA) return false;
      if (origens.filter((o) => o.origemHash === origemHash && o.t > agora - 3600_000).length >= ORIGEM_POR_HORA) return false;
      origens.push({ origemHash, t: agora });
      codigos.set(email, { hash, nonceHash, expiraMs: agora + 600_000, tentativas: 0, envios: [...envios, agora] });
      return true;
    },
    async tentarCodigo(email, nonceHash) {
      const c = codigos.get(email);
      if (!c || c.nonceHash !== nonceHash || c.tentativas >= TENTATIVAS_DO_CODIGO) return null;
      c.tentativas++;
      return { hash: c.hash, expiraMs: c.expiraMs };
    },
    async consumirCodigo(email, hash, agora) {
      const c = codigos.get(email);
      if (!c || c.hash !== hash || c.hash === "") return false;
      Object.assign(c, { hash: "", expiraMs: agora });
      return true;
    },
    async fator(email) {
      const f = fatores.get(email);
      return f ? { segredoCifrado: f.segredoCifrado, verificado: f.verificado, ultimoPasso: f.ultimoPasso } : null;
    },
    async gravarFatorNovo(email, segredoCifrado) {
      const f = fatores.get(email);
      if (f?.verificado) return false;
      fatores.set(email, { segredoCifrado, verificado: false, ultimoPasso: null, tentativas: f?.tentativas ?? 0, desde: f?.desde ?? null });
      return true;
    },
    async tentarFator(email, agora) {
      const f = fatores.get(email);
      if (!f) return false;
      if (f.desde === null || f.desde <= agora - JANELA_DO_FATOR_MS) Object.assign(f, { tentativas: 1, desde: agora });
      else if (f.tentativas < TENTATIVAS_DO_FATOR) f.tentativas++;
      else return false;
      return true;
    },
    async aceitarPasso(email, segredoCifrado, passo) {
      const f = fatores.get(email);
      if (!f || f.segredoCifrado !== segredoCifrado || (f.ultimoPasso !== null && f.ultimoPasso >= passo)) return false;
      Object.assign(f, { ultimoPasso: passo, verificado: true, tentativas: 0, desde: null });
      return true;
    },
  };
  return { store, codigos, fatores, origens };
}

function montar() {
  const m = memoria();
  const relogio = { t: 1_700_000_000_000 };
  const caixa: { para: string; codigo: string }[] = [];
  let falhaDeEmail = false;
  const login = criarLogin({
    store: m.store,
    env: ENV,
    agora: () => relogio.t,
    enviarEmail: async (para, codigo) => {
      if (falhaDeEmail) return false;
      caixa.push({ para, codigo });
      return true;
    },
    segredoAleatorio: () => SEMENTE,
  });
  return { ...m, login, relogio, caixa, falharEmail: (v: boolean) => void (falhaDeEmail = v) };
}
const A = "admin@exemplo.org";
const N = "a".repeat(32); // nonce do navegador que pediu o código
const N2 = "b".repeat(32); // outro navegador
const IP = "203.0.113.7"; // origem do pedido nos testes
const codigoAgora = (t: number, d = 0): string => hotp(SEMENTE, passoDe(t) + d);

test("código de e-mail: o banco guarda só o hash; certo entra uma vez; errado, vencido e reusado não entram", async () => {
  const s = montar();
  assert.equal(await s.login.enviarCodigo(A, N, IP), true);
  const { codigo } = s.caixa[0];
  assert.match(codigo, /^\d{6}$/);
  assert.equal(s.codigos.get(A)!.hash, hashDoCodigo(ENV, A, N, codigo));
  assert.equal(s.codigos.get(A)!.nonceHash, hashDoNonce(ENV, N));
  assert.ok(!JSON.stringify([...s.codigos]).includes(N), "o banco não guarda o nonce");
  assert.ok(!JSON.stringify([...s.codigos]).includes(codigo));
  assert.equal(await s.login.verificarCodigo(A, N, codigo === "000000" ? "000001" : "000000"), "invalido");
  assert.equal(await s.login.verificarCodigo("outro@exemplo.org", N, codigo), "invalido", "o código é do e-mail que o pediu");
  assert.equal(await s.login.verificarCodigo(A, N, codigo), "ok");
  assert.equal(await s.login.verificarCodigo(A, N, codigo), "invalido", "reuso");
  assert.equal(await s.login.verificarCodigo(A, N, ""), "invalido", "código consumido tem hash vazio: vazio não casa");

  assert.equal(await s.login.enviarCodigo(A, N, IP), true);
  s.relogio.t += 10 * 60_000;
  assert.equal(await s.login.verificarCodigo(A, N, s.caixa[1].codigo), "invalido", "vencido aos 10 min");
});

test("código de e-mail: 5 tentativas por código (a sexta não entra nem com o código certo) e 3 envios por hora", async () => {
  const s = montar();
  await s.login.enviarCodigo(A, N, IP);
  const certo = s.caixa[0].codigo;
  const errado = certo === "111111" ? "222222" : "111111";
  for (let i = 0; i < TENTATIVAS_DO_CODIGO; i++) assert.equal(await s.login.verificarCodigo(A, N, errado), "invalido");
  assert.equal(await s.login.verificarCodigo(A, N, certo), "invalido", "tentativas gastas");

  // o envio acima já gastou 1 do orçamento da origem: restam 2; o terceiro além dele é recusado, MESMO com folga no e-mail
  assert.equal(await s.login.enviarCodigo(A, N, IP), true);
  assert.equal(await s.login.enviarCodigo(A, N, IP), true);
  assert.equal(await s.login.enviarCodigo(A, N, IP), false, "quarto envio da mesma origem na hora");
  assert.equal(s.caixa.length, ORIGEM_POR_HORA);
  s.relogio.t += 3600_000 + 1;
  assert.equal(await s.login.enviarCodigo(A, N, IP), true);

  s.falharEmail(true);
  assert.equal(await s.login.enviarCodigo("b@exemplo.org", N, IP), false, "falha do e-mail = false");
});

test("código de e-mail: sem o nonce de quem pediu, nem o código certo entra, e a tentativa de terceiro não gasta as do admin", async () => {
  const s = montar();
  await s.login.enviarCodigo(A, N, IP);
  const certo = s.caixa[0].codigo;
  for (let i = 0; i < 50; i++) assert.equal(await s.login.verificarCodigo(A, N2, certo), "invalido", "outro navegador, com o código certo");
  assert.equal(s.codigos.get(A)!.tentativas, 0, "cinquenta tentativas de terceiro não contaram");
  assert.equal(await s.login.verificarCodigo(A, "", certo), "invalido");
  assert.equal(await s.login.verificarCodigo(A, N, certo), "ok", "quem pediu ainda entra");
});

test("código de e-mail: se outro pedido consumiu ou trocou o código entre conferir e consumir, não entra (uso único sob concorrência)", async () => {
  const s = montar();
  await s.login.enviarCodigo(A, N, IP);
  const certo = s.caixa[0].codigo;
  const original = s.store.consumirCodigo.bind(s.store);
  let primeira = true;
  s.store.consumirCodigo = async (email, hash, agora) => {
    if (primeira) {
      primeira = false;
      await original(email, hash, agora); // a outra requisição chegou antes
    }
    return original(email, hash, agora);
  };
  assert.equal(await s.login.verificarCodigo(A, N, certo), "invalido");
});

test("fator: se o cadastro recomeça entre conferir o código e aceitar o passo, o segredo novo NÃO fica verificado com o código do antigo", async () => {
  const s = montar();
  await s.login.iniciarCadastro(A);
  const original = s.store.aceitarPasso.bind(s.store);
  s.store.aceitarPasso = async (email, segredoCifrado, passo, agora) => {
    s.fatores.get(A)!.segredoCifrado = cifrarSegredo(ENV, A, Buffer.from("outro-segredo-de-20b!")); // outra aba chamou iniciar
    return original(email, segredoCifrado, passo, agora);
  };
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "invalido");
  assert.equal(s.fatores.get(A)!.verificado, false);
});

test("fator: cadastro devolve o segredo uma vez, só vira verificado com um código certo, e não se recadastra depois", async () => {
  const s = montar();
  assert.equal(await s.login.confirmarFator(A, "123456"), "sem_fator");
  assert.equal(await s.login.temFatorVerificado(A), false);
  const novo = await s.login.iniciarCadastro(A);
  assert.equal(novo?.segredo, paraBase32(SEMENTE));
  assert.match(novo!.uri, /^otpauth:\/\/totp\/.*secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/);
  assert.ok(!s.fatores.get(A)!.segredoCifrado.includes(novo!.segredo), "o banco não guarda o segredo em claro");
  assert.equal(await s.login.temFatorVerificado(A), false, "pendente não é verificado");
  assert.ok(await s.login.iniciarCadastro(A), "cadastro pendente pode recomeçar");

  const errado = codigoAgora(s.relogio.t) === "000000" ? "000001" : "000000";
  assert.equal(await s.login.confirmarFator(A, errado), "invalido");
  assert.equal(await s.login.temFatorVerificado(A), false);
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "ok");
  assert.equal(await s.login.temFatorVerificado(A), true);
  assert.equal(await s.login.iniciarCadastro(A), null, "fator verificado não se troca pela central");
});

test("fator: o mesmo código não entra duas vezes; o seguinte entra; passo antigo depois de um novo não entra", async () => {
  const s = montar();
  await s.login.iniciarCadastro(A);
  const c = codigoAgora(s.relogio.t);
  assert.equal(await s.login.confirmarFator(A, c), "ok");
  assert.equal(await s.login.confirmarFator(A, c), "invalido", "reuso no mesmo passo");
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t, 1)), "ok", "passo seguinte, dentro da janela");
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t, -1)), "invalido", "passo anterior ao último aceito");
});

test("fator: 5 tentativas a cada 15 min (a sexta é recusada mesmo com o código certo); recomeçar o cadastro não zera a conta; a janela reabre", async () => {
  const s = montar();
  await s.login.iniciarCadastro(A);
  const errado = (t: number): string => (codigoAgora(t) === "000000" ? "999999" : "000000");
  for (let i = 0; i < TENTATIVAS_DO_FATOR; i++) assert.equal(await s.login.confirmarFator(A, errado(s.relogio.t)), "invalido");
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "muitas");
  assert.ok(await s.login.iniciarCadastro(A));
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "muitas", "recomeçar o cadastro não dá palpites novos");
  s.relogio.t += JANELA_DO_FATOR_MS;
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "ok");
  // sucesso zera a conta
  for (let i = 0; i < TENTATIVAS_DO_FATOR - 1; i++) assert.equal(await s.login.confirmarFator(A, errado(s.relogio.t)), "invalido");
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t, 1)), "ok");
});

test("fator: segredo cifrado com outro SESSION_SECRET (ou de outro admin) não verifica", async () => {
  const s = montar();
  await s.login.iniciarCadastro(A);
  s.fatores.get(A)!.segredoCifrado = cifrarSegredo({ SESSION_SECRET: "t".repeat(48) }, A, SEMENTE);
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "invalido");
  s.fatores.get(A)!.segredoCifrado = cifrarSegredo(ENV, "outro@exemplo.org", SEMENTE);
  assert.equal(await s.login.confirmarFator(A, codigoAgora(s.relogio.t)), "invalido");
});

test("M12: uma origem sozinha não esgota o orçamento do e-mail do admin; são precisas ao menos duas, e o limite por e-mail continua valendo", async () => {
  assert.ok(ORIGEM_POR_HORA < ENVIOS_POR_HORA, "a origem precisa esgotar antes do e-mail");
  const s = montar();
  for (let i = 0; i < ORIGEM_POR_HORA; i++) assert.equal(await s.login.enviarCodigo(A, N, "198.51.100.1"), true, "atacante gasta o orçamento da origem dele");
  assert.equal(await s.login.enviarCodigo(A, N, "198.51.100.1"), false, "a origem do atacante acabou");
  assert.equal(await s.login.enviarCodigo(A, N2, "203.0.113.50"), true, "o admin, de outra origem, ainda consegue o código");
  // o atacante com várias origens esgota o e-mail (limite declarado): 6 envios no total
  assert.equal(await s.login.enviarCodigo(A, N, "198.51.100.2"), true);
  assert.equal(await s.login.enviarCodigo(A, N, "198.51.100.2"), true);
  assert.equal(await s.login.enviarCodigo(A, N, "198.51.100.3"), false, "sétimo envio: o e-mail esgotou");
  assert.equal(s.caixa.length, ENVIOS_POR_HORA);
});

test("origem: só o hash chega ao banco (nunca o IP), e a chave é própria da origem", () => {
  const h = hashDaOrigem(ENV, "203.0.113.7");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes("203.0.113.7"));
  assert.equal(h, hashDaOrigem(ENV, "203.0.113.7"));
  assert.notEqual(h, hashDaOrigem(ENV, "203.0.113.8"));
  assert.equal(hashDaOrigem(ENV, ""), hashDaOrigem(ENV, "  "), "sem IP legível: um balde só");
  assert.notEqual(h, hashDoNonce(ENV, "203.0.113.7"), "não coincide com o hash de outro uso");
});

test("ipDoPedido: cabeçalho da borda primeiro, primeiro item da lista, e lixo vira balde vazio", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(ipDoPedido(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "10.0.0.1" })), "203.0.113.7");
  assert.equal(ipDoPedido(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  assert.equal(ipDoPedido(h({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
  assert.equal(ipDoPedido(h({})), "");
  assert.equal(ipDoPedido(h({ "x-forwarded-for": "<script>" })), "");
});
