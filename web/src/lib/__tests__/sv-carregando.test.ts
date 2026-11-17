import assert from "node:assert/strict";
import { test } from "node:test";
import { trocaDePagina } from "../../components/sv/carregando-regra.ts";

// D330: quando o aviso "Carregando a página…" deve aparecer.
const aqui = "https://exemplo.org/pessoas?uf=SP";
const clique = (href: string, extra = {}) => trocaDePagina({ href, atual: aqui, ...extra });

test("outro endereço do próprio site: avisa", () => {
  assert.equal(clique("https://exemplo.org/acompanhando"), true);
  assert.equal(clique("https://exemplo.org/pessoas?uf=RJ"), true); // só o filtro mudou
  assert.equal(clique("https://exemplo.org/pessoas"), true);
  assert.equal(clique("https://exemplo.org/pessoa/fulano#gastos"), true);
});

test("o mesmo endereço, ou só a âncora: não avisa (nada é carregado)", () => {
  assert.equal(clique("https://exemplo.org/pessoas?uf=SP"), false);
  assert.equal(clique("https://exemplo.org/pessoas?uf=SP#pp-2"), false);
});

test("outra aba, outra janela ou download: não avisa", () => {
  const destino = "https://exemplo.org/acompanhando";
  assert.equal(clique(destino, { comTecla: true }), false);
  assert.equal(clique(destino, { botao: 1 }), false);
  assert.equal(clique(destino, { target: "_blank" }), false);
  assert.equal(clique(destino, { download: true }), false);
  assert.equal(clique(destino, { target: "_self" }), true);
});

test("outro site, e-mail, telefone ou endereço inválido: não avisa", () => {
  assert.equal(clique("https://www.camara.leg.br/"), false);
  assert.equal(clique("http://exemplo.org/acompanhando"), false); // outro protocolo é outra origem
  assert.equal(clique("mailto:alguem@exemplo.org"), false);
  assert.equal(clique("tel:+5561999999999"), false);
  assert.equal(clique("isto não é endereço"), false);
});
