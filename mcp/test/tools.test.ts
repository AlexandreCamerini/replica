import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { assertReadOnly, connect } from "../src/db.js";
import { buscarPolitico, compararVotos, comoVotou, gastosCota, quemMeRepresenta, ToolError, verPolitico } from "../src/tools.js";

// Testes contra o banco local (role web_reader). Pré-requisito: Postgres em localhost:54329 com os dados carregados.
const sql = connect();
after(() => sql.end({ timeout: 2 }));

const CPF = /\b\d{3}[.]?\d{3}[.]?\d{3}-?\d{2}\b/;
const semCpf = (o: unknown) => assert.doesNotMatch(JSON.stringify(o), CPF, "resposta não pode conter CPF");
const comFonteEData = (r: Record<string, unknown>) => {
  assert.ok(Array.isArray(r.fonte) && r.fonte.length > 0, "fonte");
  assert.match(String(r.atualizado_em), /^\d{4}-\d{2}-\d{2}T/, "atualizado_em");
};
async function recusa(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ToolError, `esperava ToolError, veio ${e}`);
    return e;
  }
  assert.fail("esperava erro");
}

describe("guardas do banco", () => {
  test("sessão é web_reader e somente leitura", async () => {
    await assertReadOnly(sql);
    const [r] = await sql`select current_user as u, current_setting('transaction_read_only') as ro`;
    assert.equal(r.u, "web_reader");
    assert.equal(r.ro, "on");
  });
  test("escrita é recusada", async () => {
    await assert.rejects(sql`create temp table x_civico (a int)`);
    await assert.rejects(sql`update people set display_name = display_name where false`);
  });
  test("URL com outra role é recusada antes de conectar", () => {
    assert.throws(() => connect("postgres://postgres:x@localhost:54329/civico"), /web_reader/);
  });
  test("timeout por consulta", async () => {
    const lento = connect(undefined, 300);
    try {
      await assert.rejects(lento`select pg_sleep(3)`, (e: { code?: string }) => e.code === "57014");
    } finally {
      await lento.end({ timeout: 1 });
    }
  });
});

describe("buscar_politico", () => {
  test("acha por nome sem acento e devolve campos", async () => {
    const r = await buscarPolitico(sql, { nome: "adriana ventura" });
    comFonteEData(r);
    const it = (r.itens as Record<string, unknown>[])[0];
    assert.equal(it.slug, "adriana-ventura");
    assert.equal(it.uf, "SP");
    assert.match(String(it.cargo), /Deputad/);
    assert.ok(it.partido);
  });
  test("ordem A–Z igual à do banco e respeita limite", async () => {
    const r = await buscarPolitico(sql, { nome: "silva", uf: "SP", limite: 10 });
    const itens = r.itens as { slug: string }[];
    assert.ok(itens.length > 0 && itens.length <= 10);
    const nomes = (r.itens as { nome: string }[]).map((i) => i.nome);
    const dbOrder = await sql`select p.display_name from people p where p.display_name = any(${nomes}) order by p.display_name collate pt_br`;
    assert.deepEqual([...new Set(nomes)], [...new Set(dbOrder.map((x) => String(x.display_name)))]);
  });
  test("filtro de cargo", async () => {
    const r = await buscarPolitico(sql, { nome: "silva", cargo: "senador" });
    for (const i of r.itens as { cargo: string }[]) assert.match(i.cargo, /Senador/);
  });
  test("sem resultado: sugestões e motivo, nunca erro de banco", async () => {
    const r = await buscarPolitico(sql, { nome: "adrianna ventra" });
    assert.equal(r.total, 0);
    assert.ok(r.motivo);
    assert.ok((r.sugestoes as { slug: string }[]).some((s) => s.slug === "adriana-ventura"));
  });
  test("curto demais é erro amigável", async () => {
    await recusa(buscarPolitico(sql, { nome: "a" }));
  });
  test("aspas e % no nome não quebram a consulta", async () => {
    const r = await buscarPolitico(sql, { nome: `x'; drop table people; -- %` });
    assert.equal(r.total, 0);
  });
});

describe("ver_politico", () => {
  test("Adriana bate com person_period_stats e traz fonte e data em cada número", async () => {
    const r = (await verPolitico(sql, { slug: "adriana-ventura" })) as Record<string, any>;
    comFonteEData(r);
    const [c] = await sql`select s.presence_present, s.presence_total, s.proposals_principal, s.proposals_cosigned, s.votes_registered from person_period_stats s join people p on p.id = s.person_id where p.slug = 'adriana-ventura' and s.period = 'career'`;
    assert.equal(r.presenca.desde_2019.valor.presentes, Number(c.presence_present));
    assert.equal(r.presenca.desde_2019.valor.sessoes, Number(c.presence_total));
    assert.equal(r.propostas.como_autor_principal.valor, Number(c.proposals_principal));
    assert.equal(r.propostas.como_coautor.valor, Number(c.proposals_cosigned));
    assert.equal(r.votos_nominais_registrados.valor, Number(c.votes_registered));
    assert.match(r.presenca.regra, /ausência justificada conta como ausência/);
    for (const k of [r.presenca.desde_2019, r.propostas.como_autor_principal, r.votos_nominais_registrados, r.cota_parlamentar]) {
      assert.ok(k.fonte?.url && k.atualizado_em, JSON.stringify(k));
    }
    assert.ok(r.salario.valor.mensal_brl > 0);
    assert.match(r.salario.valor.tipo, /^(teto|valor pago)/);
    assert.ok(r.patrimonio_por_eleicao.length >= 1);
    for (const p of r.patrimonio_por_eleicao) assert.ok(p.eleicao && p.fonte.url && p.atualizado_em);
    semCpf(r);
  });
  test("senador: presença é “—” com motivo, nunca zero", async () => {
    const [s] = await sql`select p.slug from people p join mandates m on m.person_id = p.id join offices o on o.id = m.office_id where o.slug = 'senador' and m.status = 'em_exercicio' order by p.slug limit 1`;
    const r = (await verPolitico(sql, { slug: String(s.slug) })) as Record<string, any>;
    assert.equal(r.presenca.desde_2019.valor, "—");
    assert.match(r.presenca.desde_2019.motivo, /Senado/);
  });
  test("Executivo: itens de plenário são “—” com motivo; teto e pendência de salário não aparecem juntos", async () => {
    const [g] = await sql`select p.slug from people p join mandates m on m.person_id = p.id join offices o on o.id = m.office_id where o.slug = 'governador' and m.status = 'em_exercicio' order by p.slug limit 1`;
    const r = (await verPolitico(sql, { slug: String(g.slug) })) as Record<string, any>;
    assert.equal(r.votos_nominais_registrados.valor, "—");
    assert.match(r.votos_nominais_registrados.motivo, /Executivo/);
    assert.ok(r.salario.valor === "—" ? Boolean(r.salario.motivo) : !r.salario.motivo);
  });
  test("slug inexistente: erro com sugestões; nome com espaços é aceito", async () => {
    const e = (await recusa(verPolitico(sql, { slug: "adriana-ventur" }))) as ToolError;
    assert.ok(e.sugestoes.length > 0);
    const r = (await verPolitico(sql, { slug: "Adriana Ventura" })) as Record<string, any>;
    assert.equal(r.pessoa.slug, "adriana-ventura");
  });
});

describe("quem_me_representa", () => {
  test("Campinas/SP: três níveis, sem duplicar quem não é da cidade", async () => {
    const r = (await quemMeRepresenta(sql, { cidade: "campinas", uf: "sp" })) as Record<string, any>;
    comFonteEData(r);
    assert.deepEqual(r.niveis.map((n: any) => n.nivel), ["cidade", "estado", "brasilia"]);
    const nomes = (n: number) => r.niveis[n].cargos.map((c: any) => c.cargo_slug);
    assert.ok(nomes(0).includes("vereador"));
    assert.ok(nomes(1).includes("deputado_estadual"));
    assert.ok(nomes(2).includes("senador") && nomes(2).includes("deputado_federal"));
    const sen = r.niveis[2].cargos.find((c: any) => c.cargo_slug === "senador");
    assert.equal(sen.total, 3);
    assert.equal(sen.truncado, false);
    semCpf(r);
  });
  test("cidade inexistente: erro com sugestões", async () => {
    const e = (await recusa(quemMeRepresenta(sql, { cidade: "Campnas", uf: "SP" }))) as ToolError;
    assert.ok(e.sugestoes.includes("Campinas"));
  });
  test("UF inexistente lista as válidas", async () => {
    const e = (await recusa(quemMeRepresenta(sql, { cidade: "x", uf: "ZZ" }))) as ToolError;
    assert.ok(e.sugestoes.includes("SP"));
  });
});

describe("como_votou", () => {
  test("filtra por ano e tema, total confere com o banco", async () => {
    const r = (await comoVotou(sql, { slug: "adriana-ventura", ano: 2025, tema: "saude", limite: 5 })) as Record<string, any>;
    comFonteEData(r);
    const [n] = await sql`select count(*)::int as n from votes v join voting_events e on e.id = v.voting_event_id join people p on p.id = v.person_id
      where p.slug = 'adriana-ventura' and e.is_nominal and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = 2025
        and exists (select 1 from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id and t.slug = 'saude')`;
    assert.equal(r.total, Number(n.n));
    assert.ok(r.votos.length <= 5);
    for (const v of r.votos) assert.match(v.data, /^2025-/);
    const datas = r.votos.map((v: any) => v.data);
    assert.deepEqual(datas, [...datas].sort().reverse());
  });
  test("tema inválido lista os válidos", async () => {
    const e = (await recusa(comoVotou(sql, { slug: "adriana-ventura", tema: "xx" }))) as ToolError;
    assert.ok(e.sugestoes.includes("saude"));
  });
  test("limite máximo é respeitado", async () => {
    const r = (await comoVotou(sql, { slug: "adriana-ventura", limite: 50 })) as Record<string, any>;
    assert.ok(r.votos.length <= 50);
  });
});

describe("comparar_votos", () => {
  test("percentual confere com contagem direta", async () => {
    const r = (await compararVotos(sql, { slug_a: "adriana-ventura", slug_b: "acacio-favacho", ano: 2025 })) as Record<string, any>;
    comFonteEData(r);
    const [c] = await sql`select count(*)::int as total, count(*) filter (where a.value = b.value)::int as iguais
      from votes a join votes b on b.voting_event_id = a.voting_event_id join voting_events e on e.id = a.voting_event_id
      where a.person_id = (select id from people where slug = 'adriana-ventura') and b.person_id = (select id from people where slug = 'acacio-favacho')
        and e.is_nominal and a.value in ('sim','nao','abstencao','obstrucao') and b.value in ('sim','nao','abstencao','obstrucao')
        and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = 2025`;
    assert.equal(r.votacoes_em_comum, Number(c.total));
    assert.equal(r.votos_iguais, Number(c.iguais));
    assert.equal(r.percentual_iguais, Math.round((1000 * Number(c.iguais)) / Number(c.total)) / 10);
    assert.ok(r.divergencias_recentes.length <= 10);
    assert.match(r.nota, /não diz qual dos dois está certo/);
  });
  test("sem votação em comum: “—” com motivo, não 0%", async () => {
    const sens = await sql`select p.slug from people p join mandates m on m.person_id = p.id join offices o on o.id = m.office_id where o.slug = 'senador' and m.status = 'em_exercicio' order by p.slug`;
    let achou = false;
    for (const s of sens) {
      const r = (await compararVotos(sql, { slug_a: "adriana-ventura", slug_b: String(s.slug) })) as Record<string, any>;
      if (r.votacoes_em_comum === 0) {
        assert.equal(r.percentual_iguais, "—");
        assert.ok(r.motivo);
        comFonteEData(r);
        achou = true;
        break;
      }
    }
    assert.ok(achou, "esperava ao menos um senador sem votação em comum com a deputada");
  });
  test("mesma pessoa é erro", async () => {
    await recusa(compararVotos(sql, { slug_a: "adriana-ventura", slug_b: "adriana-ventura" }));
  });
});

describe("gastos_cota", () => {
  test("categorias somam o total; só PJ; sem CPF", async () => {
    const r = (await gastosCota(sql, { slug: "adriana-ventura", ano: 2025 })) as Record<string, any>;
    comFonteEData(r);
    const soma = r.por_categoria.reduce((s: number, c: any) => s + Math.round(c.total_brl * 100), 0);
    assert.equal(soma, Math.round(r.total_brl * 100));
    const cats = r.por_categoria.map((c: any) => c.categoria);
    const dbCats = (await sql`select category from expenses x join people p on p.id = x.person_id where p.slug = 'adriana-ventura' and x.occurred_on >= '2025-01-01' and x.occurred_on < '2026-01-01' group by category order by category collate pt_br`).map((x) => String(x.category));
    assert.deepEqual(cats, dbCats);
    assert.ok(r.fornecedores_pj.itens.length <= 10);
    semCpf(r);
  });
  test("ano sem lançamentos: “—” com motivo", async () => {
    const r = (await gastosCota(sql, { slug: "adriana-ventura", ano: 2010 })) as Record<string, any>;
    assert.equal(r.total_brl, "—");
    assert.ok(r.motivo);
    comFonteEData(r);
  });
  test("nenhum nome de fornecedor listado tem cara de CPF (varredura em todos os parlamentares com cota 2025, amostra)", async () => {
    const ps = await sql`select distinct p.slug from expenses x join people p on p.id = x.person_id where x.occurred_on >= '2025-01-01' and x.occurred_on < '2026-01-01' order by 1 limit 40`;
    for (const p of ps) semCpf(await gastosCota(sql, { slug: String(p.slug), ano: 2025 }));
  });
});
