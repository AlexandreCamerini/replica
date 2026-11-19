import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ESTADOS_TELA,
  contagensDeAgregado,
  esperaDoExecutor,
  estadoDaFicha,
  estadoDaRodada,
  estadoDaTela,
  estadoDoExecutor,
  estadoDoPedido,
  estadoDoTerritorio,
  estadosPorTerritorio,
  formatarDe,
  formatarDuracao,
  linhasDoPainel,
  textoData,
  visaoDe,
} from "../admin/estado-tela.ts";
import { agregarPais } from "../admin/agregacao.ts";
import type { Ficha } from "../admin/tipos.ts";

test("os oito estados do prompt mais concluída e pedido existente têm nome único", () => {
  assert.equal(new Set(ESTADOS_TELA).size, ESTADOS_TELA.length);
  for (const e of ["carregando", "vazio", "erro_leitura", "executor_parado", "rodada_em_andamento", "rodada_interrompida", "rodada_concluida", "pedido_existente", "territorio_sem_ficha", "ficha_sem_evidencia"]) {
    assert.ok((ESTADOS_TELA as readonly string[]).includes(e), e);
  }
});

test("estadoDaTela: erro > carregando > vazio > estado da rodada", () => {
  assert.equal(estadoDaTela({ totalRodadas: 0, erroLeitura: true, carregando: true }), "erro_leitura");
  assert.equal(estadoDaTela({ totalRodadas: 3, carregando: true }), "carregando");
  assert.equal(estadoDaTela({ totalRodadas: 0 }), "vazio");
  assert.equal(estadoDaTela({ totalRodadas: 2, statusRodada: "em_andamento" }), "rodada_em_andamento");
  assert.equal(estadoDaTela({ totalRodadas: 2, statusRodada: "aberta" }), "rodada_em_andamento");
  assert.equal(estadoDaTela({ totalRodadas: 2, statusRodada: "interrompida" }), "rodada_interrompida");
  assert.equal(estadoDaTela({ totalRodadas: 2, statusRodada: "concluida" }), "rodada_concluida");
});

test("estadoDaRodada: falhou e status desconhecido pedem repetição (interrompida)", () => {
  assert.equal(estadoDaRodada("falhou"), "rodada_interrompida");
  assert.equal(estadoDaRodada("nao_existe"), "rodada_interrompida");
  assert.equal(estadoDaRodada(null), "rodada_interrompida");
});

test("executor parado, território sem ficha, ficha sem evidência, pedido existente", () => {
  assert.equal(estadoDoExecutor(true), "executor_parado");
  assert.equal(estadoDoExecutor(false), "executor_ok");
  assert.equal(estadoDoTerritorio(0), "territorio_sem_ficha");
  assert.equal(estadoDoTerritorio(1), "territorio_com_ficha");
  assert.equal(estadoDoPedido(false), "pedido_existente");
  assert.equal(estadoDoPedido(true), "pedido_novo");
  assert.equal(estadoDaFicha([]), "ficha_sem_evidencia");
  assert.equal(estadoDaFicha([{ url: "https://x", trecho: "", conteudo_sha256: "ab" }]), "ficha_sem_evidencia");
  assert.equal(estadoDaFicha([{ url: "https://x", trecho: "t", conteudo_sha256: "ab" }]), "ficha_com_evidencia");
});

test("espera do executor: segundos do pedido mais velho e desde quando (relógio do banco)", () => {
  assert.equal(esperaDoExecutor({ parado: false, motivoParado: null, filaMaisAntigaS: 500, batimentoMaisAntigoS: null }), null);
  const e = esperaDoExecutor({ parado: true, motivoParado: "x", filaMaisAntigaS: 90, batimentoMaisAntigoS: 30, agora: "2026-11-17T10:00:00.000Z" });
  assert.deepEqual(e, { segundos: 90, desde: "2026-11-17 09:58:30 UTC" });
  assert.equal(esperaDoExecutor({ parado: true, motivoParado: "x", filaMaisAntigaS: 90, batimentoMaisAntigoS: null })?.desde, null);
});

test("formatação: x de N, duração, data, visão", () => {
  assert.equal(formatarDe(3, 10), "3 de 10");
  assert.equal(formatarDe(0, 0), "0 de 0");
  assert.equal(formatarDe(3, null), "3 (denominador não conhecido)");
  assert.equal(formatarDe(null, null), "não medido");
  assert.equal(formatarDuracao(45), "45 s");
  assert.equal(formatarDuracao(125), "2 min 5 s");
  assert.equal(formatarDuracao(3700), "1 h 1 min");
  assert.equal(textoData("2026-11-17T10:30:00Z"), "2026-11-17 10:30:00 UTC");
  assert.equal(textoData(null), "sem data");
  assert.equal(visaoDe("revisao"), "revisao");
  assert.equal(visaoDe("qualquer"), "coleta");
});

test("linhasDoPainel: cada total vira linha com valor, de e ids; nada é somado; nulo traz o motivo", () => {
  const painel = {
    urls_tentadas: { valor: 2, de: 2, ids: [{ url_sha: "a", url: "/u1" }, { url_sha: "b", url: "/u2" }] },
    urls_com_falha: { valor: 1, de: 2, ids: [{ url_sha: "b", url: "/u2" }], por_motivo: { bloqueio: { valor: 1, de: 1, ids: [{ url_sha: "b", url: "/u2" }] } } },
    urls_entrada: { declaradas: { valor: null, de: null, ids: null, motivo: "sem lista" } },
    pendentes: { valor: 1, de: 3, ids: ["c:1:x"], sem_pendencia_aberta: { valor: 0, de: 3, ids: [] } },
    mensagem: null,
  };
  const l = linhasDoPainel(painel);
  const por = Object.fromEntries(l.map((x) => [x.caminho, x]));
  assert.equal(por.urls_tentadas.valor, 2);
  assert.deepEqual(por.urls_tentadas.ids, ["/u1", "/u2"]);
  assert.equal(por.urls_com_falha.de, 2);
  assert.equal(por["urls_com_falha.por_motivo.bloqueio"].valor, 1);
  assert.equal(por["urls_entrada.declaradas"].valor, null);
  assert.equal(por["urls_entrada.declaradas"].motivo, "sem lista");
  assert.equal(por.pendentes.de, 3);
  assert.equal(por["pendentes.sem_pendencia_aberta"].valor, 0);
  assert.equal(l.length, 6);
});

const ficha = (classe: Ficha["classe"], chave: string, ibge: string | null, nivel: "municipio" | "uf" = "municipio"): Ficha => ({
  classe,
  chave,
  rotulo: chave,
  territorio: ibge ? { ibge, nivel } : null,
  fontes: [],
});

test("estadosPorTerritorio: coleta falhou > em andamento > lida > sem tentativa; revisão reaberta > pendente > sem pendência", () => {
  const fs = [ficha("vinculo_sapl", "1", "3550308"), ficha("cobertura", "3550308:x", "3550308"), ficha("vinculo_sapl", "2", "1200401"), ficha("vinculo_sapl", "3", "3304557"), ficha("vinculo_sapl", "4", null)];
  const c = estadosPorTerritorio("coleta", {
    fichas: fs,
    alcancados: ["vinculo_sapl:1"],
    naoAlcancados: [{ id: "cobertura:3550308:x", motivo_falha: "robots" }, { id: "vinculo_sapl:2", motivo_falha: null }],
    rodadaEmAndamento: true,
  });
  assert.equal(c.get("mun:3550308"), "falhou");
  assert.equal(c.get("uf:35"), "falhou");
  assert.equal(c.get("mun:1200401"), "em_andamento");
  assert.equal(c.get("mun:3304557"), "sem_tentativa");
  assert.equal(c.has("uf:null"), false);
  const r = estadosPorTerritorio("revisao", { fichas: fs, fila: [{ classe: "vinculo_sapl", registro_chave: "1", reaberta: false }, { classe: "cobertura", registro_chave: "3550308:x", reaberta: true }] });
  assert.equal(r.get("mun:3550308"), "reaberta");
  assert.equal(r.get("mun:1200401"), "sem_pendencia");
});

test("contagensDeAgregado tem o formato de /admin/api/estado e fecha com o total", () => {
  const fs = [ficha("vinculo_sapl", "1", "3550308"), ficha("vinculo_sapl", "2", "35", "uf"), ficha("vinculo_sapl", "3", null)];
  const c = contagensDeAgregado(agregarPais(fs));
  assert.equal(c.total, 3);
  assert.deepEqual(c.porUf, { "35": 2 });
  assert.equal(c.semTerritorio.total, 1);
  assert.equal(Object.values(c.porUf).reduce((a, b) => a + b, 0) + c.semTerritorio.total, c.total);
});
