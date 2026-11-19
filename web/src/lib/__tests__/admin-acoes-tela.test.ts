import assert from "node:assert/strict";
import { test } from "node:test";
import { acompanharPedido, anunciarMudanca, resumoVivo, TENTATIVAS_SEM_VER } from "../admin/acompanhar.ts";
import { chaveDoRascunho, botaoDaDecisao, botaoDaRecoleta, confirmacaoDeDecisao, confirmacaoDeRecoleta, confirmacaoDeRepetir, contarPendentes, lerRascunho, rascunhoVazio, serializarRascunho, valorNovoDaDecisao } from "../admin/confirmacao.ts";
import { classificarFalha, FALHA_BANCO, mesmaFalha } from "../admin/falhas.ts";
import { PROMESSA_EXECUTOR, resumoDoExecutor, ultimoSinal } from "../admin/executor-tela.ts";

test("falhas: um tipo por situação, com próxima ação; nada de detalhe técnico", () => {
  assert.equal(classificarFalha({ rede: true }).tipo, "rede");
  assert.equal(classificarFalha({ status: null }).tipo, "rede");
  assert.equal(classificarFalha({ status: 503 }).tipo, "banco");
  assert.equal(classificarFalha({ status: 503 }).titulo, "Não foi possível ler o banco");
  assert.equal(classificarFalha({ status: 500 }).tipo, "servidor");
  assert.equal(classificarFalha({ status: 429 }).tipo, "limite");
  assert.equal(classificarFalha({ status: 403 }).tipo, "recusado");
  const sessao = classificarFalha({ status: 404 });
  assert.equal(sessao.tipo, "sessao");
  assert.equal(sessao.href, "/admin/entrar");
  assert.equal(classificarFalha({ status: 404, mensagem: "ficha não encontrada" }).tipo, "nao_encontrado");
  assert.equal(classificarFalha({ status: 400, mensagem: "justificativa obrigatória" }).mensagem, "justificativa obrigatória");
  for (const s of [null, 400, 403, 404, 429, 500, 503]) {
    const f = classificarFalha({ status: s });
    assert.ok(f.acao.length > 10 && f.titulo.length > 5, String(s));
    assert.ok(!/stack|sql|postgres|ECONN/i.test(`${f.titulo} ${f.mensagem} ${f.acao}`));
  }
  assert.equal(FALHA_BANCO.tipo, "banco");
  assert.equal(mesmaFalha(classificarFalha({ status: 503 }), classificarFalha({ status: 503 })), true);
  assert.equal(mesmaFalha(classificarFalha({ status: 503 }), classificarFalha({ status: 429 })), false);
  assert.equal(mesmaFalha(null, null), true);
  assert.equal(mesmaFalha(null, FALHA_BANCO), false);
});

test("executor: último sinal vem do pedido mais recente (batimento, fim ou início); sem sinal diz que não há", () => {
  const agora = "2026-11-17T10:30:00Z";
  assert.equal(ultimoSinal([]), null);
  assert.equal(ultimoSinal(null), null);
  const s = ultimoSinal([{ iniciado_em: "2026-11-17T10:00:00Z", batimento_em: null, finalizado_em: "2026-11-17T10:20:00Z" }, { iniciado_em: "2026-11-17T09:00:00Z", batimento_em: "2026-11-17T10:25:00Z" }]);
  assert.equal(s?.toISOString(), "2026-11-17T10:25:00.000Z");
  const r = resumoDoExecutor([{ batimento_em: "2026-11-17T10:25:00Z" }], agora);
  assert.equal(r.visto, "Executor visto há 5 min (17/11/2026 07:25)");
  assert.equal(r.segundosDesdeSinal, 300);
  assert.equal(r.promessa, PROMESSA_EXECUTOR);
  assert.match(PROMESSA_EXECUTOR, /até ~5 s/);
  assert.equal(resumoDoExecutor([], agora).visto, "Sem sinal registrado do executor nos pedidos recentes");
});

test("acompanhar pedido: na fila, em execução, concluído, falhou com erro, interrompido, sumiu", () => {
  const rec = [
    { id: "a", status: "na_fila" },
    { id: "b", status: "em_execucao", andamento: { etapa: "x", mensagem: "lendo 3 de 10" } },
    { id: "c", status: "concluido" },
    { id: "d", status: "falhou", erro: "fonte fora do ar" },
    { id: "e", status: "interrompido", erro: "executor encerrado (SIGTERM)" },
  ];
  assert.match(acompanharPedido("a", rec).texto, /^Na fila\. Com o executor ativo, um pedido começa em até ~5 s\./);
  assert.equal(acompanharPedido("a", rec).terminal, false);
  assert.equal(acompanharPedido("b", rec).texto, "Em execução: lendo 3 de 10");
  assert.deepEqual([acompanharPedido("c", rec).terminal, acompanharPedido("c", rec).problema], [true, false]);
  const d = acompanharPedido("d", rec);
  assert.deepEqual([d.fase, d.terminal, d.problema, d.erro], ["falhou", true, true, "fonte fora do ar"]);
  assert.match(d.texto, /Falhou: fonte fora do ar/);
  assert.equal(acompanharPedido("e", rec).fase, "interrompido");
  assert.equal(acompanharPedido("zzz", rec, 0).fase, "aguardando");
  assert.equal(acompanharPedido("zzz", rec, TENTATIVAS_SEM_VER).fase, "perdido");
  assert.equal(acompanharPedido("zzz", null, TENTATIVAS_SEM_VER).terminal, true);
});

test("região viva: só mudança de estado é anunciada; oscilação de contagem não", () => {
  const base = { executor: { parado: false, naFila: 0 }, rodadasEmCurso: [] as { id: string }[] };
  const a = resumoVivo(base);
  assert.equal(anunciarMudanca(null, a), null);
  assert.equal(anunciarMudanca(a, resumoVivo({ ...base, executor: { parado: false, naFila: 7 } })), null);
  assert.match(anunciarMudanca(a, resumoVivo({ ...base, executor: { parado: true, naFila: 1 } })) ?? "", /Executor parado/);
  assert.match(anunciarMudanca(resumoVivo({ ...base, executor: { parado: true, naFila: 1 } }), a) ?? "", /voltou/);
  const com = resumoVivo({ ...base, rodadasEmCurso: [{ id: "r1" }] });
  assert.match(anunciarMudanca(a, com) ?? "", /entrou em andamento/);
  assert.match(anunciarMudanca(com, a) ?? "", /saiu de andamento/);
  assert.equal(anunciarMudanca(com, com), null);
});

const dec = { acao: "aprovar", aplicar: true, campo: "base_url", classe: "vinculo_sapl", fichaRotulo: "Câmara de Adamantina", territorio: "Adamantina (SP)", valorAtual: "https://a.exemplo", candidatos: ["https://b.exemplo"], valorCorrigido: "", justificativa: "confere", operador: "Ana" };

test("confirmação de decisão: campo, valor atual, valor novo, escopo e botão que diz o efeito", () => {
  const c = confirmacaoDeDecisao(dec);
  assert.equal(c.botao, "Aprovar e aplicar");
  const m = Object.fromEntries(c.itens.map((i) => [i.rotulo, i.valor]));
  assert.equal(m["Campo"], "base_url");
  assert.equal(m["Valor atual"], "https://a.exemplo");
  assert.equal(m["Valor novo"], "https://b.exemplo");
  assert.match(m["Escopo"], /^1 ficha: Câmara de Adamantina \(Vínculo SAPL\), Adamantina \(SP\)$/);
  assert.equal(m["Decidindo como"], "Ana");
  assert.deepEqual(c.avisos, []);
  assert.equal(botaoDaDecisao("aprovar", false), "Aprovar (sem aplicar)");
  assert.equal(botaoDaDecisao("corrigir", true), "Corrigir e aplicar");
  assert.equal(botaoDaDecisao("descartar", true), "Descartar pendência");
  assert.equal(botaoDaDecisao("pedir_confirmacao", false), "Pedir confirmação");
  assert.match(confirmacaoDeDecisao({ ...dec, aplicar: false }).itens.find((i) => i.rotulo === "Efeito")?.valor ?? "", /NÃO é aplicada/);
});

test("valor novo: aprovar sem candidato ou com candidatos divergentes avisa que o executor recusa; corrigir usa o valor informado", () => {
  assert.equal(valorNovoDaDecisao({ acao: "aprovar", candidatos: [], valorCorrigido: "" }).aviso?.includes("recusar"), true);
  assert.equal(valorNovoDaDecisao({ acao: "aprovar", candidatos: ["a", "b"], valorCorrigido: "" }).texto, "2 candidatos diferentes");
  assert.deepEqual(valorNovoDaDecisao({ acao: "corrigir", candidatos: ["a"], valorCorrigido: " x " }), { texto: "x", aviso: null });
  assert.equal(valorNovoDaDecisao({ acao: "descartar", candidatos: [], valorCorrigido: "" }).texto, "sem mudança de valor");
});

test("recoleta: o botão diz quantas fichas e onde; sem classe pré-escolhida a contagem vem por classe e território exato", () => {
  assert.equal(botaoDaRecoleta({ classe: "vinculo_sapl", territorioNome: "São Paulo", nivel: "uf", pendentes: 12, truncado: false }), "Recoletar 12 fichas em São Paulo");
  assert.equal(botaoDaRecoleta({ classe: "vinculo_sapl", territorioNome: "São Paulo", nivel: "uf", pendentes: 1, truncado: false }), "Recoletar 1 ficha em São Paulo");
  assert.equal(botaoDaRecoleta({ classe: "vinculo_sapl", territorioNome: "São Paulo", nivel: "uf", pendentes: 1000, truncado: true }), "Recoletar 1000 ou mais fichas em São Paulo");
  assert.equal(botaoDaRecoleta({ classe: "vinculo_sapl", territorioNome: "São Paulo", nivel: "uf", pendentes: null, truncado: false }), "Recoletar fichas pendentes em São Paulo");
  const itens = [
    { classe: "vinculo_sapl", registro_chave: "1", territorio: { ibge: "35", nivel: "uf" } },
    { classe: "vinculo_sapl", registro_chave: "1", territorio: { ibge: "35", nivel: "uf" } },
    { classe: "vinculo_sapl", registro_chave: "2", territorio: { ibge: "35", nivel: "uf" } },
    { classe: "vinculo_sapl", registro_chave: "3", territorio: { ibge: "3500105", nivel: "municipio" } },
    { classe: "cobertura", registro_chave: "9:x", territorio: { ibge: "35", nivel: "uf" } },
    { classe: "vinculo_sapl", registro_chave: "4", territorio: null },
  ];
  assert.deepEqual(contarPendentes(itens, "vinculo_sapl", { ibge: "35", nivel: "uf" }), { fichas: 2, pendencias: 3, truncado: false });
  assert.equal(contarPendentes(itens, "cobertura", { ibge: "11", nivel: "uf" }).fichas, 0);
  const conf = confirmacaoDeRecoleta({ classe: "vinculo_sapl", territorioNome: "São Paulo", nivel: "uf", pendentes: 0, truncado: false });
  assert.equal(conf.avisos.length, 1);
  assert.equal(conf.itens.find((i) => i.rotulo === "Coletor")?.valor, "sapl.assembleias");
});

test("repetir rodada: escopo e botão com efeito", () => {
  const c = confirmacaoDeRepetir({ coletor: "sapl.assembleias", modo: "recoletar", recorte: { ufs: ["PB"] }, soPendencias: true });
  assert.equal(c.botao, "Repetir só pendências de sapl.assembleias");
  assert.equal(c.itens.find((i) => i.rotulo === "Recorte")?.valor, "estado: Paraíba");
  assert.equal(confirmacaoDeRepetir({ coletor: "x", modo: "recoletar", recorte: undefined, soPendencias: false }).botao, "Repetir rodada de x");
});

test("rascunho de decisão: ida e volta; texto corrompido ou de outra forma vira null; rascunho vazio não se guarda", () => {
  const r = { acao: "corrigir", justificativa: "porque sim", valor: "https://x.exemplo", aplicar: true };
  assert.deepEqual(lerRascunho(serializarRascunho(r)), r);
  for (const ruim of [null, undefined, "", "{", "[]", "null", JSON.stringify({ ...r, acao: "apagar" }), JSON.stringify({ ...r, aplicar: "sim" }), JSON.stringify({ acao: "aprovar" })]) assert.equal(lerRascunho(ruim), null, String(ruim));
  assert.equal(rascunhoVazio({ acao: "aprovar", justificativa: "  ", valor: "", aplicar: false }), true);
  assert.equal(rascunhoVazio(r), false);
  assert.equal(chaveDoRascunho("p1"), "adm-rascunho-decisao:p1");
});
