import type { Sql } from "./db.js";

// Regras de produto copiadas do site (web/src/lib/data/pg.ts e /sobre), de propósito sem importar de lá:
// o servidor MCP é um pacote independente. Neutralidade: nenhuma ferramenta ranqueia nem avalia pessoa;
// listas saem em ordem A–Z ou por data. Única ordenação por valor: "maiores fornecedores" da cota (ver decisão D82).

export const PAGE_MAX = 50;
export const REP_CAP = 200; // acima do maior grupo real (deputados estaduais de SP = 94)

export type Fonte = { nome: string; url: string };
export type Campo = { valor: unknown; fonte: Fonte | null; atualizado_em: string | null; motivo?: string; nota?: string };
export type Resposta = Record<string, unknown> & { fonte: Fonte[]; atualizado_em: string | null };

export class ToolError extends Error {
  constructor(message: string, readonly sugestoes: unknown[] = []) {
    super(message);
  }
}

type Row = Record<string, unknown>;
const brl = (cents: unknown) => (cents === null || cents === undefined ? null : Math.round(Number(cents)) / 100);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d ?? "").slice(0, 10));
const isoTs = (d: unknown) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);
/** minúsculas, sem acento, espaços colapsados */
export const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const likeEsc = (s: string) => s.replace(/[\\%_]/g, "\\$&");
const slugify = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// ---------- carimbos (fonte + data de cada número) ----------
type Stamp = { dataset: string; at: string; nome: string; url: string };
const cache = new WeakMap<object, { at: number; rows: Stamp[] }>();
async function stamps(sql: Sql): Promise<Stamp[]> {
  const hit = cache.get(sql);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = (await sql`select ds.dataset, ds.refreshed_at, s.name, s.url from dataset_stamps ds join sources s on s.id = ds.source_id`).map((r) => ({
    dataset: String(r.dataset),
    at: isoTs(r.refreshed_at)!,
    nome: String(r.name),
    url: String(r.url),
  }));
  cache.set(sql, { at: Date.now(), rows });
  return rows;
}
/** Carimbo do dataset exato do ano (`camara.despesas` + 2025 -> `camara.despesas.2025`); sem ano, o mais recente do prefixo. */
async function stampOf(sql: Sql, dataset: string, year?: number | string | null): Promise<Stamp | null> {
  const all = await stamps(sql);
  if (year) {
    const exact = all.find((s) => s.dataset === `${dataset}.${year}`);
    if (exact) return exact;
  }
  const same = all.filter((s) => s.dataset === dataset || s.dataset.startsWith(`${dataset}.`));
  return same.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}
const fonteOf = (s: Stamp | null): Fonte | null => (s ? { nome: s.nome, url: s.url } : null);
const campo = (valor: unknown, s: Stamp | null, motivo?: string, nota?: string): Campo =>
  valor === null || valor === undefined
    ? { valor: "—", fonte: fonteOf(s), atualizado_em: s?.at ?? null, motivo: motivo ?? "não publicado pela fonte" }
    : { valor, fonte: fonteOf(s), atualizado_em: s?.at ?? null, ...(nota ? { nota } : {}) };
/** junta carimbos sem repetir fonte; `atualizado_em` = a data mais antiga entre eles (o número mais velho manda) */
function resposta(body: Record<string, unknown>, ss: (Stamp | null)[]): Resposta {
  const ok = ss.filter((s): s is Stamp => !!s);
  const fonte = [...new Map(ok.map((s) => [s.url, { nome: s.nome, url: s.url }])).values()];
  const atualizado_em = ok.length ? ok.map((s) => s.at).sort()[0] : null;
  return { ...body, fonte, atualizado_em };
}

// ---------- pessoas ----------
const OFFICES = ["presidente", "vice_presidente", "senador", "deputado_federal", "governador", "vice_governador", "deputado_estadual", "deputado_distrital", "prefeito", "vice_prefeito", "vereador"] as const;
export const OFFICE_SLUGS = OFFICES;
const EXECUTIVE = new Set(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);
const BODY_OF: Record<string, "camara" | "senado"> = { deputado_federal: "camara", senador: "senado" };
const ACTIVE = ["em_exercicio", "licenciado", "afastado"];

const HOLDER = (sql: Sql) => sql`
  select p.id, p.slug, p.display_name, p.civil_name, p.gender, m.id as mandate_id, o.slug as office, o.name_m, o.name_f, o.level, m.status, m.started_on, m.ends_on, m.status_source,
         pl.id as place_id, pl.ibge_code as place_ibge, pl.name as place_name, pl.kind as place_kind, pl.uf as place_uf,
         pa.acronym as party_acronym
  from mandates m
  join people p on p.id = m.person_id
  join offices o on o.id = m.office_id
  join places pl on pl.id = m.place_id
  left join person_current_party cp on cp.person_id = p.id
  left join parties pa on pa.id = coalesce(cp.party_id, m.party_id)`;
const cargo = (r: Row) => String(r.gender === "f" ? r.name_f : r.name_m);
const local = (r: Row) => (r.place_kind === "municipio" ? `${r.place_name} · ${r.place_uf}` : String(r.place_name));
const lista = (r: Row) => ({ slug: String(r.slug), nome: String(r.display_name), cargo: cargo(r), partido: String(r.party_acronym ?? "—"), uf: r.place_uf ? String(r.place_uf) : "—", local: local(r), situacao: String(r.status) });

/** pg_trgm mora no schema `extensions` (padrão Supabase); sem ele, cai no `like` e nunca derruba a ferramenta */
async function suggestPeople(sql: Sql, text: string): Promise<{ slug: string; nome: string }[]> {
  const q = norm(text);
  if (q.length < 2) return [];
  const exists = sql`exists (select 1 from mandates m where m.person_id = p.id)`;
  let rows: Row[];
  try {
    rows = await sql`
      select p.slug, p.display_name from people p
      where ${exists} and (extensions.similarity(f_unaccent(lower(p.display_name)), ${q}::text) > 0.3 or f_unaccent(lower(p.display_name)) like '%' || ${likeEsc(q)} || '%')
      order by extensions.similarity(f_unaccent(lower(p.display_name)), ${q}::text) desc, p.display_name collate pt_br limit 5`;
  } catch {
    rows = await sql`select p.slug, p.display_name from people p where ${exists} and f_unaccent(lower(p.display_name)) like '%' || ${likeEsc(q)} || '%' order by p.display_name collate pt_br limit 5`;
  }
  return rows.map((r) => ({ slug: String(r.slug), nome: String(r.display_name) })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

type Pessoa = { id: string; slug: string; nome: string; nomeCivil: string; redirecionado: boolean };
async function resolverPessoa(sql: Sql, entrada: string): Promise<Pessoa> {
  const slug = slugify(entrada);
  if (slug.length < 2) throw new ToolError("Informe o slug (ex.: adriana-ventura) ou o nome da pessoa.");
  const [r] = await sql`select id, slug, display_name, civil_name from people where slug = ${slug}`;
  if (r) return { id: String(r.id), slug: String(r.slug), nome: String(r.display_name), nomeCivil: String(r.civil_name ?? r.display_name), redirecionado: false };
  const [red] = await sql`select p.id, p.slug, p.display_name, p.civil_name from person_slug_redirects s join people p on p.id = s.person_id where s.old_slug = ${slug}`;
  if (red) return { id: String(red.id), slug: String(red.slug), nome: String(red.display_name), nomeCivil: String(red.civil_name ?? red.display_name), redirecionado: true };
  const sug = await suggestPeople(sql, entrada);
  throw new ToolError(`Não encontrei ninguém com o slug "${slug}". Use buscar_politico para achar o slug certo.`, sug);
}

// ---------- 1. buscar_politico ----------
export async function buscarPolitico(sql: Sql, a: { nome: string; uf?: string; cargo?: string; pagina?: number; limite?: number }): Promise<Resposta> {
  const tokens = norm(a.nome).split(" ").filter((t) => t.length >= 2).slice(0, 6);
  if (!tokens.length) throw new ToolError("Informe ao menos um nome com 2 letras ou mais.");
  const limite = Math.min(a.limite ?? 20, PAGE_MAX);
  const offset = ((a.pagina ?? 1) - 1) * limite;
  const nameWhere = tokens.reduce(
    (acc, t) => sql`${acc} and (f_unaccent(lower(p.display_name)) like '%' || ${likeEsc(t)} || '%' or f_unaccent(lower(p.civil_name)) like '%' || ${likeEsc(t)} || '%')`,
    sql`true`,
  );
  const where = sql`m.status in ${sql(ACTIVE)} ${a.uf ? sql`and pl.uf = ${a.uf}` : sql``} ${a.cargo ? sql`and o.slug = ${a.cargo}` : sql``} and ${nameWhere}`;
  const [{ n }] = await sql`select count(*)::int as n from mandates m join people p on p.id = m.person_id join offices o on o.id = m.office_id join places pl on pl.id = m.place_id where ${where}`;
  const rows = await sql`${HOLDER(sql)} where ${where} order by p.display_name collate pt_br, p.slug, m.started_on desc limit ${limite} offset ${offset}`;
  const body: Record<string, unknown> = {
    total: Number(n),
    pagina: a.pagina ?? 1,
    por_pagina: limite,
    ordem: "A–Z por nome",
    escopo: "mandatos em exercício, licenciados ou afastados; ex-ocupantes não entram",
    itens: rows.map(lista),
  };
  if (!Number(n)) {
    body.sugestoes = await suggestPeople(sql, a.nome);
    body.motivo = "nenhum mandato atual casa com o nome e os filtros; confira a grafia ou tire os filtros";
  }
  return resposta(body, [await stampOf(sql, "camara.deputados"), await stampOf(sql, "senado.senadores"), await stampOf(sql, "tse.candidatos")]);
}

// ---------- 2. ver_politico ----------
const FEDERAL_REASON: Record<string, string> = {
  propostas: "a carga das matérias de autoria no Senado entra na próxima fase",
  gastos_gabinete: "a carga da cota do Senado entra na próxima fase",
  presenca: "o Senado não publica a lista de presença por senador",
  votos: "ainda não carregado para esta casa",
};
const REGRA_PRESENCA =
  "Lista oficial de presença das sessões deliberativas do Plenário (Câmara): presente = em exercício e consta da lista; ausência justificada conta como ausência (a fonte não informa o motivo); licença e suplência não viram falta. Mede presença em sessão, não produtividade.";
const OWN_DATASETS: Record<string, string[]> = {
  deputado_estadual: ["presenca", "votos", "propostas", "gastos_gabinete"],
  deputado_distrital: ["presenca", "votos", "propostas", "gastos_gabinete"],
  vereador: ["presenca", "votos", "propostas", "gastos_gabinete"],
};

export async function verPolitico(sql: Sql, a: { slug: string }): Promise<Resposta> {
  const p = await resolverPessoa(sql, a.slug);
  const ms = await sql`${HOLDER(sql)} where p.id = ${p.id}::uuid
    order by case m.status when 'em_exercicio' then 0 when 'eleito_aguardando_posse' then 1 when 'licenciado' then 2 when 'afastado' then 2 else 3 end, m.started_on desc limit 12`;
  const prim = ms.find((m) => m.status !== "eleito_aguardando_posse");
  const office = prim ? String(prim.office) : null;
  const body = office ? BODY_OF[office] ?? null : null;
  const ano = new Date().getFullYear();

  const statRows = await sql`select period, presence_present, presence_total, proposals_principal, proposals_cosigned, votes_registered, expenses_cents, missing_datasets
    from person_period_stats where person_id = ${p.id}::uuid and period in ('career', ${String(ano)})`;
  const career = statRows.find((r) => r.period === "career");
  const cur = statRows.find((r) => r.period === String(ano));
  const missingSet = new Set<string>((career?.missing_datasets as string[] | undefined) ?? []);
  const cov = prim && prim.level !== "federal" ? await sql`select dataset, reason from data_coverage where place_id = ${prim.place_id as string}::uuid and status <> 'no_site'` : [];

  /** "—" com motivo, nunca zero: Executivo não tem plenário; federal usa missing_datasets; estadual/municipal usa data_coverage */
  const motivoFalta = (ds: string): string | null => {
    if (!office) return "esta pessoa não tem mandato carregado";
    if (EXECUTIVE.has(office)) return "cargo do Executivo: não tem sessões, votos nem propostas de plenário";
    if (prim!.level === "federal") return missingSet.has(ds) ? FEDERAL_REASON[ds] ?? "carga pendente" : null;
    if (!(OWN_DATASETS[office] ?? []).includes(ds)) return null;
    return String(cov.find((c) => c.dataset === ds)?.reason ?? "ainda não carregado para este cargo e lugar");
  };
  const sCamaraPres = body === "camara" ? await stampOf(sql, "camara.presenca", ano) : null;
  const nunca = (ds: string, v: unknown, st: Stamp | null, nota?: string) => {
    const m = motivoFalta(ds);
    return m ? campo(null, st, m) : v === null ? campo(null, st, "não publicado pela fonte para este período") : campo(v, st, undefined, nota);
  };

  // salário: teto OU pago, e a resposta diz qual (teto e "não conferido" nunca juntos)
  let salario: Campo;
  if (prim) {
    const [sa] = await sql`select s.amount_cents, s.is_ceiling, s.valid_from, so.name, so.url from salaries s join sources so on so.id = s.source_id
      join offices o on o.id = s.office_id
      where o.slug = ${office} and (s.place_id = ${prim.place_id as string}::uuid or s.place_id is null) and s.valid_from <= current_date
      order by s.place_id nulls last, s.valid_from desc limit 1`;
    if (sa)
      salario = {
        valor: { mensal_brl: brl(sa.amount_cents), tipo: sa.is_ceiling ? "teto fixado pela Constituição (não é o valor pago)" : "valor pago, fixado em norma publicada", vigente_desde: iso(sa.valid_from) },
        fonte: { nome: String(sa.name), url: String(sa.url) },
        atualizado_em: iso(sa.valid_from),
      };
    else {
      const motivo = office === "governador" || office === "vice_governador" ? "fixado por lei de cada estado; ainda não conferimos a lei deste estado" : String(cov.find((c) => String(c.dataset).startsWith("salario"))?.reason ?? "salário deste cargo e lugar ainda não carregado");
      salario = campo(null, null, motivo);
    }
  } else salario = campo(null, null, "esta pessoa não tem mandato carregado");

  // patrimônio declarado ao TSE, por eleição
  const pat = await sql`select e.year, o.name_m, ad.total_cents from asset_declarations ad
    join candidacies c on c.id = ad.candidacy_id join elections e on e.id = c.election_id join contests ct on ct.id = c.contest_id join offices o on o.id = ct.office_id
    where ad.person_id = ${p.id}::uuid order by e.year desc limit 10`;
  const patrimonio = await Promise.all(
    pat.map(async (r) => {
      const st = await stampOf(sql, "tse.candidatos", Number(r.year));
      return { eleicao: Number(r.year), cargo_disputado: String(r.name_m), ...campo(brl(r.total_cents), st, undefined, "valor nominal declarado naquela eleição; não corrigido pela inflação") };
    }),
  );

  const sPres = sCamaraPres;
  const sVotos = body ? await stampOf(sql, `${body}.votacoes`) : null;
  const sProp = body ? await stampOf(sql, body === "camara" ? "camara.proposicoes" : "senado.autorias") : null;
  const sCota = body ? await stampOf(sql, `${body}.despesas`, ano) : null;
  const pct = (r: Row | undefined) => (r && r.presence_total ? Math.round((1000 * Number(r.presence_present)) / Number(r.presence_total)) / 10 : null);
  const pres = (r: Row | undefined) => (r && r.presence_present !== null && r.presence_total !== null ? { presentes: Number(r.presence_present), sessoes: Number(r.presence_total), percentual: pct(r) } : null);

  const out = {
    pessoa: { slug: p.slug, nome: p.nome, nome_civil: p.nomeCivil, ...(p.redirecionado ? { observacao: "slug antigo; redirecionado para o atual" } : {}) },
    mandatos: ms.map((m) => ({
      cargo: cargo(m), local: local(m), partido: String(m.party_acronym ?? "—"), situacao: String(m.status), inicio: iso(m.started_on), fim_previsto: iso(m.ends_on), situacao_segundo: String(m.status_source),
    })),
    salario,
    patrimonio_por_eleicao: patrimonio.length ? patrimonio : campo(null, await stampOf(sql, "tse.candidatos"), "nenhuma declaração de bens registrada nas candidaturas carregadas"),
    presenca: {
      regra: body === "senado" ? "O Senado não publica lista de presença por senador em formato aberto; não a estimamos a partir dos votos." : REGRA_PRESENCA,
      desde_2019: nunca("presenca", pres(career), sPres),
      [`ano_${ano}`]: nunca("presenca", pres(cur), sPres),
    },
    propostas: {
      periodo: "desde 2019 (período carregado)",
      como_autor_principal: nunca("propostas", num(career?.proposals_principal), sProp),
      como_coautor: nunca("propostas", num(career?.proposals_cosigned), sProp),
    },
    votos_nominais_registrados: { periodo: "desde 2019 (período carregado)", ...nunca("votos", num(career?.votes_registered), sVotos) },
    cota_parlamentar: { ano, ...nunca("gastos_gabinete", cur?.expenses_cents != null ? brl(cur.expenses_cents) : null, sCota, "soma dos lançamentos do ano, em reais; estornos entram como a fonte publica") },
    aviso: "Os dados descrevem; não avaliam. Número ausente aparece como “—” com o motivo, nunca como zero.",
  };
  return resposta(out, [
    sPres, sVotos, sProp, sCota, await stampOf(sql, "tse.candidatos"),
    await stampOf(sql, prim?.status_source === "senado" ? "senado.senadores" : "camara.deputados"),
  ]);
}

// ---------- 3. quem_me_representa ----------
export async function quemMeRepresenta(sql: Sql, a: { cidade: string; uf: string }): Promise<Resposta> {
  const uf = a.uf.toUpperCase();
  const [ufRow] = await sql`select ibge_code, name from places where kind = 'uf' and uf = ${uf}`;
  if (!ufRow) {
    const ufs = (await sql`select uf from places where kind = 'uf' order by uf`).map((r) => String(r.uf));
    throw new ToolError(`UF "${a.uf}" não existe. Use a sigla de duas letras.`, ufs);
  }
  const q = norm(a.cidade);
  let cands = await sql`select ibge_code, name, uf from places where kind = 'municipio' and uf = ${uf} and f_unaccent(lower(name)) = ${q}`;
  if (cands.length === 0)
    cands = await sql`select ibge_code, name, uf from places where kind = 'municipio' and uf = ${uf} and f_unaccent(lower(name)) like ${likeEsc(q)} || '%' order by name collate pt_br limit 6`;
  if (cands.length !== 1) {
    const sug = cands.length
      ? cands.map((r) => String(r.name))
      : (await sql`select name from places where kind = 'municipio' and uf = ${uf} order by extensions.similarity(f_unaccent(lower(name)), ${q}::text) desc, name collate pt_br limit 5`.catch(() => [])).map((r) => String(r.name));
    throw new ToolError(cands.length ? `"${a.cidade}" é ambíguo em ${uf}; escolha uma e repita.` : `Não encontrei "${a.cidade}" em ${uf}.`, sug);
  }
  const city = cands[0];
  const rows = await sql`${HOLDER(sql)}
    where m.status = 'em_exercicio' and (pl.ibge_code = 'BR' or (pl.kind = 'uf' and pl.uf = ${uf}) or pl.ibge_code = ${String(city.ibge_code)})
    order by p.display_name collate pt_br, p.slug`;
  const mk = (nivel: string, lugar: string, offices: string[], motivoVazio?: string) => {
    const cargos = offices
      .map((o) => {
        const rs = rows.filter((r) => r.office === o);
        return rs.length ? { cargo: cargo(rs[0]).replace(/\(a\)$/, ""), cargo_slug: o, total: rs.length, truncado: rs.length > REP_CAP, itens: rs.slice(0, REP_CAP).map((r) => ({ slug: String(r.slug), nome: String(r.display_name), partido: String(r.party_acronym ?? "—") })) } : null;
      })
      .filter(Boolean);
    const sem = offices.filter((o) => !rows.some((r) => r.office === o) && EXECUTIVE.has(o));
    return {
      nivel, lugar, cargos,
      ...(sem.length ? { sem_mandato_em_exercicio: sem, motivo_sem_mandato: "nenhum mandato em exercício carregado para este cargo (vago, cassado, eleito aguardando posse ou dado não carregado)" } : {}),
      ...(cargos.length ? {} : { valor: "—", motivo: motivoVazio ?? "ainda não carregado" }),
    };
  };
  const niveis = [
    mk("cidade", `${city.name} · ${uf}`, ["prefeito", "vice_prefeito", "vereador"], "eleitos desta cidade ainda não carregados"),
    mk("estado", String(ufRow.name), ["governador", "vice_governador", uf === "DF" ? "deputado_distrital" : "deputado_estadual"], "eleitos deste estado ainda não carregados"),
    mk("brasilia", "Brasília (União)", ["presidente", "vice_presidente", "senador", "deputado_federal"]),
  ];
  return resposta(
    { cidade: { nome: String(city.name), uf, ibge: String(city.ibge_code) }, ordem: "níveis na ordem cidade, estado, Brasília; dentro de cada cargo, A–Z por nome", niveis },
    [await stampOf(sql, "tse.candidatos", 2024), await stampOf(sql, "camara.deputados"), await stampOf(sql, "senado.senadores"), await stampOf(sql, "ibge.places")],
  );
}

// ---------- 4. como_votou ----------
const VOTO: Record<string, string> = { sim: "Sim", nao: "Não", abstencao: "Abstenção", obstrucao: "Obstrução", art17: "Art. 17", nao_votou: "Não votou" };
async function resolverTema(sql: Sql, tema: string): Promise<string> {
  const ts = await sql`select slug, name from topics order by name collate pt_br`;
  const q = norm(tema);
  const hit = ts.find((t) => t.slug === q || norm(String(t.name)) === q);
  if (!hit) throw new ToolError(`Tema "${tema}" não existe. Temas válidos: use um dos slugs sugeridos.`, ts.map((t) => String(t.slug)));
  return String(hit.slug);
}
const DESC = (sql: Sql) => sql`case when pr.id is not null then pr.type || ' ' || pr.number || '/' || pr.year || ' — ' || left(pr.summary_official, 220) || ' · ' || e.description else e.description end`;

export async function comoVotou(sql: Sql, a: { slug: string; tema?: string; ano?: number; pagina?: number; limite?: number }): Promise<Resposta> {
  const p = await resolverPessoa(sql, a.slug);
  const tema = a.tema ? await resolverTema(sql, a.tema) : null;
  const limite = Math.min(a.limite ?? 15, PAGE_MAX);
  const offset = ((a.pagina ?? 1) - 1) * limite;
  const where = sql`v.person_id = ${p.id}::uuid and e.is_nominal
    ${a.ano ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${a.ano}` : sql``}
    ${tema ? sql`and exists (select 1 from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id and t.slug = ${tema})` : sql``}`;
  const [{ n }] = await sql`select count(*)::int as n from votes v join voting_events e on e.id = v.voting_event_id where ${where}`;
  const rows = await sql`
    select e.occurred_at, b.kind as body, e.result, e.yes_count, e.no_count, v.value, ${DESC(sql)} as description,
           (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
    from votes v join voting_events e on e.id = v.voting_event_id join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id
    where ${where} order by e.occurred_at desc, v.id desc limit ${limite} offset ${offset}`;
  const casas = [...new Set(rows.map((r) => String(r.body)))];
  const stampsUsed = await Promise.all((casas.length ? casas : ["camara", "senado"]).map((c) => stampOf(sql, `${c === "senado" ? "senado" : "camara"}.votacoes`, a.ano)));
  const body: Record<string, unknown> = {
    pessoa: { slug: p.slug, nome: p.nome },
    filtros: { tema: tema ?? "—", ano: a.ano ?? "—" },
    total: Number(n),
    pagina: a.pagina ?? 1,
    por_pagina: limite,
    ordem: "mais recentes primeiro (por data)",
    votos: rows.map((r) => ({
      data: iso(new Date(String(isoTs(r.occurred_at)))),
      casa: r.body === "senado" ? "Senado" : "Câmara",
      descricao: String(r.description).slice(0, 320),
      tema: r.topic ? String(r.topic) : "—",
      voto: VOTO[String(r.value)] ?? String(r.value),
      resultado: r.result ? String(r.result) : "—",
      placar: { sim: num(r.yes_count), nao: num(r.no_count) },
    })),
    nota: "Só votações nominais. No Senado, votação secreta não tem voto individual e não aparece. Tema vem de regra de palavras-chave sobre a proposição, não de avaliação.",
  };
  if (!Number(n)) body.motivo = "nenhum voto nominal carregado para este filtro (a casa pode não ter carregado esta pessoa ou este período)";
  return resposta(body, stampsUsed);
}

// ---------- 5. comparar_votos ----------
export async function compararVotos(sql: Sql, a: { slug_a: string; slug_b: string; ano?: number }): Promise<Resposta> {
  const A = await resolverPessoa(sql, a.slug_a);
  const B = await resolverPessoa(sql, a.slug_b);
  if (A.id === B.id) throw new ToolError("Informe duas pessoas diferentes.");
  const VALID = ["sim", "nao", "abstencao", "obstrucao"];
  const base = sql`from votes va join votes vb on vb.voting_event_id = va.voting_event_id and vb.person_id = ${B.id}::uuid
    join voting_events e on e.id = va.voting_event_id join legislative_bodies b on b.id = e.body_id left join proposals pr on pr.id = e.proposal_id
    where va.person_id = ${A.id}::uuid and e.is_nominal and va.value in ${sql(VALID)} and vb.value in ${sql(VALID)}
    ${a.ano ? sql`and extract(year from e.occurred_at at time zone 'America/Sao_Paulo') = ${a.ano}` : sql``}`;
  const [t] = await sql`select count(*)::int as total, count(*) filter (where va.value = vb.value)::int as iguais ${base}`;
  const total = Number(t.total);
  const iguais = Number(t.iguais);
  const div = total
    ? await sql`select e.occurred_at, b.kind as body, va.value as a, vb.value as b, ${DESC(sql)} as description,
        (select t.slug from proposal_topics pt join topics t on t.id = pt.topic_id where pt.proposal_id = e.proposal_id order by t.slug limit 1) as topic
        ${base} and va.value <> vb.value order by e.occurred_at desc limit 10`
    : [];
  const casas = total ? (await sql`select distinct b.kind ${base}`).map((r) => String(r.kind)) : ["camara", "senado"];
  const ss = await Promise.all(casas.map((c) => stampOf(sql, `${c === "senado" ? "senado" : "camara"}.votacoes`, a.ano)));
  const body: Record<string, unknown> = {
    a: { slug: A.slug, nome: A.nome },
    b: { slug: B.slug, nome: B.nome },
    periodo: a.ano ?? "desde 2019 (período carregado)",
    votacoes_em_comum: total,
    ...(total
      ? { votos_iguais: iguais, percentual_iguais: Math.round((1000 * iguais) / total) / 10, divergencias_total: total - iguais }
      : { percentual_iguais: "—", motivo: "nenhuma votação nominal em comum com voto sim/não/abstenção/obstrução dos dois (casas diferentes ou períodos sem sobreposição)" }),
    divergencias_recentes: div.map((r) => ({
      data: iso(new Date(String(isoTs(r.occurred_at)))), casa: r.body === "senado" ? "Senado" : "Câmara", descricao: String(r.description).slice(0, 280), tema: r.topic ? String(r.topic) : "—", [A.slug]: VOTO[String(r.a)], [B.slug]: VOTO[String(r.b)],
    })),
    ordem_divergencias: "mais recentes primeiro, até 10",
    nota: "Conta só votações nominais em que os dois votaram sim, não, abstenção ou obstrução. Mede coincidência de voto; não diz qual dos dois está certo nem é nota de ninguém.",
  };
  return resposta(body, ss);
}

// ---------- 6. gastos_cota ----------
export async function gastosCota(sql: Sql, a: { slug: string; ano: number }): Promise<Resposta> {
  const p = await resolverPessoa(sql, a.slug);
  const bodyRows = await sql`select distinct b.kind from expenses x join legislative_bodies b on b.id = x.body_id where x.person_id = ${p.id}::uuid`;
  const casa = bodyRows.some((r) => r.kind === "senado") ? "senado" : "camara";
  const st = await stampOf(sql, `${casa}.despesas`, a.ano);
  const yr = sql`x.person_id = ${p.id}::uuid and x.occurred_on >= make_date(${a.ano}, 1, 1) and x.occurred_on < make_date(${a.ano + 1}, 1, 1)`;
  const [tot] = await sql`select count(*)::int as n, sum(amount_cents)::bigint as cents from expenses x where ${yr}`;
  if (!Number(tot.n)) {
    const [m] = await sql`select 1 as x from mandates m join offices o on o.id = m.office_id where m.person_id = ${p.id}::uuid and o.slug in ('deputado_federal','senador') limit 1`;
    return resposta(
      { pessoa: { slug: p.slug, nome: p.nome }, ano: a.ano, total_brl: "—", motivo: m ? `nenhum lançamento de cota carregado para ${a.ano}` : "a cota parlamentar carregada é a de deputados federais e senadores; esta pessoa não tem mandato federal carregado" },
      [st],
    );
  }
  const cats = await sql`select category, sum(amount_cents)::bigint as cents, count(*)::int as n from expenses x where ${yr} group by 1 order by category collate pt_br`;
  // PJ apenas: CNPJ = 14 dígitos (a fonte publica o CPF de pessoa física com 11; nunca listamos). Nome com cara de CPF (MEI) fica de fora.
  const forn = await sql`
    with pj as (
      select regexp_replace(supplier_doc, '[^0-9]', '', 'g') as doc, min(supplier_name) as nome, sum(amount_cents)::bigint as cents, count(*)::int as n,
             bool_or(supplier_name ~ '[0-9]{11}' or supplier_name ~ '[0-9]{3}[.][0-9]{3}[.][0-9]{3}-[0-9]{2}') as parece_cpf
      from expenses x where ${yr} and length(regexp_replace(supplier_doc, '[^0-9]', '', 'g')) = 14 and regexp_replace(supplier_doc, '[^0-9]', '', 'g') !~ '^0+$'
      group by 1)
    select doc, nome, cents, n, parece_cpf from pj`;
  const nomeaveis = forn.filter((f) => !f.parece_cpf).sort((x, y) => Number(y.cents) - Number(x.cents)).slice(0, 10);
  const somaNomeada = nomeaveis.reduce((s, f) => s + Number(f.cents), 0);
  const totPJ = forn.reduce((s, f) => s + Number(f.cents), 0);
  return resposta(
    {
      pessoa: { slug: p.slug, nome: p.nome },
      ano: a.ano,
      total_brl: brl(tot.cents),
      lancamentos: Number(tot.n),
      nota: "Soma dos lançamentos do ano, em reais; estornos e glosas entram como a fonte publica (podem ser negativos).",
      por_categoria: cats.map((c) => ({ categoria: String(c.category), total_brl: brl(c.cents), lancamentos: Number(c.n) })),
      ordem_categorias: "A–Z",
      fornecedores_pj: {
        criterio: "os 10 de maior valor total no ano entre pessoas jurídicas (CNPJ), listados em ordem alfabética; não é avaliação",
        itens: nomeaveis.map((f) => ({ fornecedor: String(f.nome), total_brl: brl(f.cents), lancamentos: Number(f.n) })).sort((x, y) => x.fornecedor.localeCompare(y.fornecedor, "pt-BR")),
        valor_pj_fora_da_lista_brl: brl(totPJ - somaNomeada),
      },
      valor_sem_cnpj_brl: brl(Number(tot.cents) - totPJ),
      privacidade: "Pessoa física (CPF) nunca é listada; o valor dela só entra no total e em “sem CNPJ”.",
    },
    [st],
  );
}
