import "server-only";
import { NextResponse } from "next/server";
import { agregarPais } from "./agregacao.ts";
import { sqlAdmin } from "./db.ts";
import { exigirAdmin } from "./guarda.ts";
import {
  ErroPedidoInvalido,
  SQL_CAMPOS_COM_PROPOSTA,
  SQL_CAMPOS_CONFIRMADOS_PELA_FONTE,
  SQL_CAMPOS_CONFIRMADOS_POR_DECISAO,
  SQL_CAMPOS_CONFLITANTES,
  SQL_CAMPOS_PENDENTES,
  SQL_CAMPOS_SEM_PENDENCIA,
  SQL_DECISOES,
  SQL_EXECUTOR_ESTADO,
  SQL_FICHAS,
  SQL_FICHAS_POR_CHAVES,
  SQL_FICHA_BASE,
  SQL_FICHA_DECISOES,
  SQL_FICHA_PARECERES,
  SQL_FICHA_PEDIDOS_DECISAO,
  SQL_FICHA_PENDENCIAS,
  SQL_FICHA_PROPOSTAS,
  SQL_FILA,
  SQL_FILA_PROPOSTAS,
  SQL_PEDIDOS_RECENTES,
  SQL_PEDIDO_DECISAO_EXISTENTE,
  SQL_PEDIDO_DECISAO_INSERIR,
  SQL_PEDIDO_EXISTENTE,
  SQL_PEDIDO_INSERIR,
  SQL_PENDENCIAS_ABERTAS_POR_CLASSE,
  SQL_PENDENCIAS_LIGADAS,
  SQL_PENDENCIAS_REABERTAS,
  SQL_RODADA,
  SQL_RODADAS,
  SQL_RODADAS_EM_CURSO,
  SQL_RODADA_PEDIDOS,
  SQL_REGISTROS_ALCANCADOS,
  SQL_REGISTROS_ALTERADOS,
  SQL_REGISTROS_COM_PROPOSTA,
  SQL_REGISTROS_ELEGIVEIS,
  SQL_REGISTROS_NAO_ALCANCADOS,
  SQL_URLS_COM_FALHA,
  SQL_URLS_ENTRADA_DECLARADAS,
  SQL_URLS_ENTRADA_NAO_TENTADAS,
  SQL_URLS_ENTRADA_TENTADAS,
  SQL_URLS_LIDAS,
  SQL_URLS_REAPROVEITADAS,
  SQL_URLS_TENTADAS,
  SQL_VIGENTE_COBERTURA,
  SQL_VIGENTE_CONTATOS,
  SQL_VIGENTE_IDENTIDADE,
  SQL_VIGENTE_SAPL,
  chaveIdemDecisao,
  chaveIdemPedido,
  ehUuid,
  jsonCanonico,
  validarDecisao,
  validarPedido,
} from "./sql.ts";
import { CLASSES, NIVEL_POR_KIND } from "./tipos.ts";
import type { Classe, Ficha, MotivoSemMapa, Territorio } from "./tipos.ts";

// Consultas da central. Toda função exportada começa por `exigirAdmin()` (layout e página renderizam em paralelo: a página não pode consultar o banco quando o
// layout responde 404) e só depois abre o pool próprio (db.ts). NUNCA lê pelo cache de dados do site (`unstable_cache`): é o estado de agora.
// Erro de banco vira `ErroLeituraBanco` (ou `ErroGravacaoBanco`): a mensagem é fixa e não leva detalhe técnico; a página mostra "erro de leitura do banco".

export { ErroPedidoInvalido };

export class ErroDaCentral extends Error {}
export class ErroLeituraBanco extends ErroDaCentral {
  constructor() {
    super("erro de leitura do banco");
    this.name = "ErroLeituraBanco";
  }
}
export class ErroGravacaoBanco extends ErroDaCentral {
  constructor() {
    super("erro ao gravar o pedido");
    this.name = "ErroGravacaoBanco";
  }
}
export class ErroNaoEncontrado extends ErroDaCentral {
  constructor(o: string) {
    super(`${o} não encontrada`);
    this.name = "ErroNaoEncontrado";
  }
}
/** As somas do relatório não fecham (rodada em andamento ou dado inconsistente), como o `ErroAdmin` do relatório da CLI. */
export class ErroInvariante extends ErroDaCentral {
  constructor(m: string) {
    super(m);
    this.name = "ErroInvariante";
  }
}

// ---------------------------------------------------------------------------------------------------------------------------- acesso ao banco

type Param = string | number | boolean | null;
type Linha = Record<string, unknown>;
type Consulta = <T = Linha>(texto: string, params?: Param[]) => Promise<T[]>;
type ComUnsafe = { unsafe: (texto: string, params?: never) => PromiseLike<unknown> };

const consultaDe =
  (sql: ComUnsafe): Consulta =>
  async <T,>(texto: string, params: Param[] = []) =>
    (await sql.unsafe(texto, params as never)) as unknown as T[];

const codigoDe = (e: unknown): string => (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" ? (e as { code: string }).code : "sem_codigo");

/** Roda `fn` com o pool da central. `instantaneo`: uma transação só de leitura com um único retrato do banco (as somas do relatório precisam disso). */
async function lendo<T>(fn: (q: Consulta) => Promise<T>, instantaneo = false): Promise<T> {
  try {
    const sql = sqlAdmin();
    if (instantaneo) return (await sql.begin("isolation level repeatable read read only", (tx) => fn(consultaDe(tx as unknown as ComUnsafe)))) as T;
    return await fn(consultaDe(sql as unknown as ComUnsafe));
  } catch (e) {
    if (e instanceof ErroDaCentral || e instanceof ErroPedidoInvalido) throw e;
    console.error("[admin] erro de leitura do banco:", codigoDe(e)); // só o código do Postgres: nunca a mensagem, a URL nem variável de ambiente
    throw new ErroLeituraBanco();
  }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const ordenadas = (xs: string[]): string[] => [...xs].sort(cmp);

// ---------------------------------------------------------------------------------------------------------------------------- território

const MOTIVO_IDENTIDADE =
  "casamento de identidade não tem território: o item da fila não guarda lugar, e o local de nascimento da pessoa não é território do registro";

/** Mesma regra de `_territorio_de` (classes.py): sem ibge_code = sem território; kind fora de município, UF e país = sem território. */
function territorioDe(classe: string, ibge: string | null, kind: string | null): { territorio: Territorio | null; motivo: string | null } {
  if (classe === "identidade") return { territorio: null, motivo: MOTIVO_IDENTIDADE };
  if (!ibge) return { territorio: null, motivo: "o lugar do registro não tem ibge_code" };
  const nivel = kind !== null && Object.hasOwn(NIVEL_POR_KIND, kind) ? NIVEL_POR_KIND[kind] : undefined;
  if (nivel === undefined) return { territorio: null, motivo: `o lugar do registro é do tipo '${kind}', que não é município, UF nem país` };
  return { territorio: { ibge, nivel }, motivo: null };
}

type LinhaFicha = { classe: string; chave: string; rotulo: string; ibge_code: string | null; kind: string | null; fontes: string[] };

const ehClasse = (x: unknown): x is Classe => typeof x === "string" && (CLASSES as readonly string[]).includes(x);

function paraFicha(l: LinhaFicha): Ficha {
  const { territorio } = territorioDe(l.classe, l.ibge_code, l.kind);
  const f: Ficha = { classe: l.classe as Classe, chave: l.chave, rotulo: l.rotulo, territorio, fontes: l.fontes ?? [] };
  if (territorio === null && l.classe !== "identidade") f.motivoSemTerritorio = "territorio_nao_resolvido" satisfies MotivoSemMapa;
  return f;
}

/** As fichas das quatro classes (alimenta agregacao.ts: mapa, contagens, "Ver registros"). Uma por classe+chave; duplicata de chave é unificada por agregacao.ts. */
export async function fichas(): Promise<Ficha[]> {
  exigirAdmin();
  const linhas = await lendo((q) => q<LinhaFicha>(SQL_FICHAS));
  return linhas.map(paraFicha);
}

// ---------------------------------------------------------------------------------------------------------------------------- relatório da rodada

const SEM_TENTATIVAS = "tentativas não registradas para este coletor";
const SEM_PROPOSTA = "nenhuma proposta registrada nesta rodada";
const MOTIVOS_FALHA = ["bloqueio", "robots", "expiracao", "erro", "sem_conteudo"] as const;

/** `{valor, de, ids}` como no JSON de `civico-etl admin relatorio --json`. */
export type Total = { valor: number; de: number | null; ids: unknown[]; motivo_de?: string };
export type TotalNulo = { valor: null; de: null; ids: null; motivo: string };
export type RelatorioRodada = {
  simulado: string | null;
  rodada: { id: string; coletor: string; modo: string; recorte: unknown; status: string; iniciada_em: unknown; finalizada_em: unknown; repete_id: string | null };
  /** Painel da coleta. Nunca somado ao da revisão. */
  coleta: Record<string, unknown>;
  /** Painel da revisão. Nunca somado ao da coleta. */
  revisao: Record<string, unknown>;
};

const total = (ids: unknown[], de: number | null, extra: Record<string, unknown> = {}): Total => ({ valor: ids.length, de, ids, ...extra }) as Total;
const nulo = (motivo: string): TotalNulo => ({ valor: null, de: null, ids: null, motivo });

type LinhaUrl = { url_sha: string; url: string; motivo?: string };
const urls = (rows: LinhaUrl[]): { url_sha: string; url: string }[] => rows.map((r) => ({ url_sha: r.url_sha, url: r.url })).sort((a, b) => cmp(a.url_sha, b.url_sha));
type LinhaReg = { classe: string; registro_chave: string | null; rotulo?: string };
const reg = (r: LinhaReg): string => (r.registro_chave !== null ? `${r.classe}:${r.registro_chave}` : `${r.classe}:~sem_registro(${r.rotulo})`);
type LinhaCampo = { classe: string; registro_chave: string; campo: string; motivo_reabertura?: string | null };
const campoId = (r: LinhaCampo): string => `${r.classe}:${r.registro_chave}:${r.campo}`;

type Previa = {
  urls_entrada?: unknown;
  tentativas_registradas?: unknown;
  registros_elegiveis?: { valor?: unknown; motivo?: string } | null;
  resultado?: { simulado?: string | null } | null;
};

async function painelColeta(q: Consulta, rid: string, coletor: string, pv: Previa): Promise<Record<string, unknown>> {
  // A CLI lê `tentativas_registradas` do catálogo do ETL (Python). A central lê o valor que a prévia da rodada guardou ao abrir. Prévia sem a marca = "fora do catálogo".
  const registra = typeof pv.tentativas_registradas === "boolean" ? pv.tentativas_registradas : null;
  const motivo = registra === false ? SEM_TENTATIVAS : registra === null ? `coletor '${coletor}' fora do catálogo: não se sabe se registra tentativas` : null;
  const temEntrada = Array.isArray(pv.urls_entrada);
  const declaradas = temEntrada ? urls(await q<LinhaUrl>(SQL_URLS_ENTRADA_DECLARADAS, [rid])) : null;
  const nDecl = declaradas ? declaradas.length : null;
  const semPrev = "a prévia da rodada não lista URLs de entrada (coletor sem lista de entrada conhecida)";
  const out: Record<string, unknown> = {};
  if (motivo) {
    out.urls_tentadas = nulo(motivo);
    out.urls_lidas = nulo(motivo);
    out.urls_reaproveitadas = nulo(motivo);
    out.urls_com_falha = { ...nulo(motivo), por_motivo: null };
    out.urls_entrada = { declaradas: declaradas ? total(declaradas, nDecl) : nulo(semPrev), tentadas: nulo(motivo), declaradas_nao_tentadas: nulo(motivo) };
    out.registros_elegiveis = nulo(motivo);
    out.registros_alcancados = nulo(motivo);
    out.registros_elegiveis_nao_alcancados = { ...nulo(motivo), itens: null };
    return out;
  }
  const tent = urls(await q<LinhaUrl>(SQL_URLS_TENTADAS, [rid]));
  const n = tent.length;
  const lidas = urls(await q<LinhaUrl>(SQL_URLS_LIDAS, [rid]));
  const reap = urls(await q<LinhaUrl>(SQL_URLS_REAPROVEITADAS, [rid]));
  const falhas = (await q<LinhaUrl>(SQL_URLS_COM_FALHA, [rid])).map((r) => ({ url_sha: r.url_sha, url: r.url, motivo: r.motivo })).sort((a, b) => cmp(a.url_sha, b.url_sha));
  if (lidas.length + reap.length + falhas.length !== n) {
    throw new ErroInvariante(`lidas (${lidas.length}) + reaproveitadas (${reap.length}) + com falha (${falhas.length}) != tentadas (${n})`);
  }
  const porMotivo = Object.fromEntries(
    MOTIVOS_FALHA.map((m) => [m, total(falhas.filter((f) => f.motivo === m).map((f) => ({ url_sha: f.url_sha, url: f.url })), falhas.length)]),
  ) as Record<string, Total>;
  if (Object.values(porMotivo).reduce((s, t) => s + t.valor, 0) !== falhas.length) throw new ErroInvariante("falhas por motivo não somam as falhas");
  out.urls_tentadas = total(tent, n);
  out.urls_lidas = total(lidas, n);
  out.urls_reaproveitadas = total(reap, n);
  out.urls_com_falha = { ...total(falhas.map((f) => ({ url_sha: f.url_sha, url: f.url })), n), por_motivo: porMotivo };
  const et = urls(await q<LinhaUrl>(SQL_URLS_ENTRADA_TENTADAS, [rid]));
  if (declaradas === null) {
    out.urls_entrada = { declaradas: nulo(semPrev), tentadas: total(et, null, { motivo_de: semPrev }), declaradas_nao_tentadas: nulo(semPrev) };
  } else {
    out.urls_entrada = {
      declaradas: total(declaradas, nDecl),
      tentadas: total(et, nDecl),
      declaradas_nao_tentadas: total(urls(await q<LinhaUrl>(SQL_URLS_ENTRADA_NAO_TENTADAS, [rid])), nDecl),
    };
  }
  const eleg = await q<LinhaReg>(SQL_REGISTROS_ELEGIVEIS, [rid]);
  const el = pv.registros_elegiveis ?? {};
  const temLista = Number.isInteger(el.valor);
  const motivoDe = temLista ? null : el.motivo || "a prévia da rodada não tem a lista de registros elegíveis";
  const extraDe = temLista ? {} : { motivo_de: motivoDe };
  const alc = await q<LinhaReg>(SQL_REGISTROS_ALCANCADOS, [rid]);
  out.registros_elegiveis = total(ordenadas(eleg.map(reg)), eleg.length, extraDe);
  out.registros_alcancados = total(ordenadas(alc.map(reg)), temLista ? eleg.length : null, extraDe);
  const nao = await q<LinhaReg & { situacao: string; motivo_falha: string | null }>(SQL_REGISTROS_NAO_ALCANCADOS, [rid]);
  const itens = nao.map((r) => ({ id: reg(r), rotulo: r.rotulo, situacao: r.situacao, motivo_falha: r.motivo_falha })).sort((a, b) => cmp(a.id, b.id));
  out.registros_elegiveis_nao_alcancados = { ...total(itens.map((i) => i.id), temLista ? eleg.length : null, extraDe), itens };
  return out;
}

type LinhaDecisao = { id: string; acao: string; decidido_por_tipo: string; aplicada: boolean };
const fatias = (dec: LinhaDecisao[], chave: "acao" | "decidido_por_tipo"): Record<string, Total> =>
  Object.fromEntries(
    ordenadas([...new Set(dec.map((d) => d[chave]))]).map((v) => [v, total(ordenadas(dec.filter((d) => d[chave] === v).map((d) => d.id)), dec.length)]),
  );

async function painelRevisao(q: Consulta, rid: string): Promise<Record<string, unknown>> {
  const campos = (await q<LinhaCampo>(SQL_CAMPOS_COM_PROPOSTA, [rid])).map(campoId);
  const n = campos.length;
  const ids = async (sql: string): Promise<string[]> => ordenadas((await q<LinhaCampo>(sql, [rid])).map(campoId));
  const conf = await ids(SQL_CAMPOS_CONFLITANTES);
  const pend = await ids(SQL_CAMPOS_PENDENTES);
  const pela = await ids(SQL_CAMPOS_CONFIRMADOS_PELA_FONTE);
  const decC = await ids(SQL_CAMPOS_CONFIRMADOS_POR_DECISAO);
  const semPend = await ids(SQL_CAMPOS_SEM_PENDENCIA);
  if (conf.length + pend.length + pela.length + decC.length !== n || new Set([...conf, ...pend, ...pela, ...decC]).size !== n) {
    throw new ErroInvariante(`conflitantes (${conf.length}) + pendentes (${pend.length}) + confirmados (${pela.length + decC.length}) != campos com proposta (${n})`);
  }
  const reabRows = await q<LinhaCampo>(SQL_PENDENCIAS_REABERTAS, [rid]);
  const reab = ordenadas(reabRows.map(campoId));
  const nAbertas = conf.length + pend.length;
  const motivos = ordenadas([...new Set(reabRows.map((r) => String(r.motivo_reabertura)))]);
  const porMotivo = Object.fromEntries(motivos.map((m) => [m, total(ordenadas(reabRows.filter((r) => String(r.motivo_reabertura) === m).map(campoId)), nAbertas)]));
  const regsProp = (await q<LinhaReg>(SQL_REGISTROS_COM_PROPOSTA, [rid])).map((r) => `${r.classe}:${r.registro_chave}`);
  const alt = ordenadas((await q<LinhaReg>(SQL_REGISTROS_ALTERADOS, [rid])).map((r) => `${r.classe}:${r.registro_chave}`));
  const pendLig = (await q<{ id: string }>(SQL_PENDENCIAS_LIGADAS, [rid])).map((r) => r.id);
  const dec = await q<LinhaDecisao>(SQL_DECISOES, [rid]);
  return {
    campos_com_proposta: total(campos, n),
    conflitantes: total(conf, n),
    pendentes: { ...total(pend, n), sem_pendencia_aberta: total(semPend, n) },
    confirmados: { ...total(ordenadas([...pela, ...decC]), n), pela_fonte: total(pela, n), por_decisao: total(decC, n) },
    pendencias_reabertas: { ...total(reab, nAbertas), por_motivo: porMotivo },
    registros_com_proposta: total(ordenadas(regsProp), regsProp.length),
    registros_alterados: total(alt, regsProp.length),
    decisoes: {
      ...total(
        ordenadas(dec.map((d) => d.id)),
        pendLig.length,
      ),
      por_acao: fatias(dec, "acao"),
      por_decidido_por_tipo: fatias(dec, "decidido_por_tipo"),
      aplicadas: total(ordenadas(dec.filter((d) => d.aplicada).map((d) => d.id)), dec.length),
      nao_aplicadas: total(ordenadas(dec.filter((d) => !d.aplicada).map((d) => d.id)), dec.length),
    },
    pendencias_ligadas: total(pendLig, pendLig.length),
    mensagem: n === 0 ? SEM_PROPOSTA : null,
  };
}

type LinhaRodada = {
  id: string;
  coletor: string;
  modo: string;
  recorte: unknown;
  previa: Previa | null;
  status: string;
  iniciada_em: unknown;
  finalizada_em: unknown;
  repete_id: string | null;
};

/**
 * Os dois painéis da rodada, em objetos SEPARADOS (`coleta` e `revisao`, nunca somados), com os mesmos números do `civico-etl admin relatorio ID --json`:
 * as consultas são as constantes copiadas do ETL (sql.ts), numa única transação só de leitura (um retrato do banco).
 * Diferença declarada: `tentativas_registradas` vem da prévia gravada na rodada, não do catálogo do ETL.
 */
export async function relatorioDaRodada(id: string): Promise<RelatorioRodada> {
  exigirAdmin();
  if (!ehUuid(id)) throw new ErroNaoEncontrado("rodada");
  const rid = id.toLowerCase();
  return lendo(async (q) => {
    const rod = (await q<LinhaRodada>(SQL_RODADA, [rid]))[0];
    if (!rod) throw new ErroNaoEncontrado("rodada");
    const pv = rod.previa ?? {};
    return {
      simulado: pv.resultado?.simulado || null,
      rodada: { id: rod.id, coletor: rod.coletor, modo: rod.modo, recorte: rod.recorte, status: rod.status, iniciada_em: rod.iniciada_em, finalizada_em: rod.finalizada_em, repete_id: rod.repete_id },
      coleta: await painelColeta(q, rid, rod.coletor, pv),
      revisao: await painelRevisao(q, rid),
    };
  }, true);
}

// ---------------------------------------------------------------------------------------------------------------------------- fila

type LinhaFila = {
  id: string;
  classe: string;
  registro_chave: string;
  campo: string;
  tipo: string;
  pergunta: string;
  reaberta: boolean;
  motivo_reabertura: string | null;
  evidencia_sha: string | null;
  vigente_sha: string | null;
  vence_em: unknown;
  cobertura_recorte: string | number | null;
  criada_em: unknown;
};
type LinhaProposta = { pendencia_id: string } & Linha;

/**
 * Pendências abertas na ordem de `SQL_FILA` (restrição 7: classe, tipo, vencimento, cobertura do recorte, id; NUNCA por pessoa, partido ou popularidade).
 * O rótulo, o território e as propostas são buscados DEPOIS, em consultas separadas, e não reordenam nada.
 */
export async function fila(classe?: string, limite?: number) {
  exigirAdmin();
  if (classe !== undefined && !ehClasse(classe)) throw new ErroPedidoInvalido("classe inválida");
  if (limite !== undefined && (!Number.isInteger(limite) || limite < 1 || limite > 1000)) throw new ErroPedidoInvalido("limite tem de ser um inteiro de 1 a 1000");
  return lendo(async (q) => {
    const rows = await q<LinhaFila>(SQL_FILA, [classe ?? null, limite ?? null]);
    const fichasPor = new Map<string, LinhaFicha>();
    const propostas = new Map<string, Linha[]>();
    if (rows.length > 0) {
      const pares = JSON.stringify(rows.map((r) => ({ classe: r.classe, chave: r.registro_chave })));
      for (const f of await q<LinhaFicha>(SQL_FICHAS_POR_CHAVES, [pares])) fichasPor.set(`${f.classe}:${f.chave}`, f);
      for (const p of await q<LinhaProposta>(SQL_FILA_PROPOSTAS, [JSON.stringify(rows.map((r) => r.id))])) {
        const { pendencia_id, ...resto } = p;
        (propostas.get(pendencia_id) ?? propostas.set(pendencia_id, []).get(pendencia_id)!).push(resto);
      }
    }
    return rows.map((r, i) => {
      const f = fichasPor.get(`${r.classe}:${r.registro_chave}`);
      const t = f ? territorioDe(r.classe, f.ibge_code, f.kind) : { territorio: null, motivo: "registro inexistente" };
      const desconhecidos: Record<string, string> = {};
      if (!f) desconhecidos.rotulo = "o registro não existe mais na tabela de origem";
      if (t.territorio === null) desconhecidos.territorio = t.motivo ?? "território desconhecido";
      if (r.vence_em === null) desconhecidos.vence_em = "vencimento não registrado ou a classe não tem prazo de revalidação";
      if (r.cobertura_recorte === null) desconhecidos.cobertura_recorte = "a proposta não veio de rodada com lista de registros elegíveis, ou o coletor não registra tentativas";
      return {
        posicao: i + 1,
        ...r,
        cobertura_recorte: r.cobertura_recorte === null ? null : Number(r.cobertura_recorte),
        rotulo: f?.rotulo ?? null,
        territorio: t.territorio,
        propostas: propostas.get(r.id) ?? [],
        desconhecidos,
      };
    });
  });
}

// ---------------------------------------------------------------------------------------------------------------------------- ficha

const UUID_CHAVE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Chave estável bem formada para a classe (a mesma regra de chaves do ETL); sem isto a consulta nem roda. */
function chaveValida(classe: Classe, chave: string): boolean {
  if (classe === "vinculo_sapl") return /^\d{1,17}$/.test(chave);
  if (classe === "cobertura") return /^\d+:[a-z_]+$/.test(chave);
  return UUID_CHAVE.test(chave);
}

async function vigentesDe(q: Consulta, classe: Classe, chave: string): Promise<Map<string, unknown>> {
  const m = new Map<string, unknown>();
  if (classe === "vinculo_sapl") {
    const r = (await q<{ base_url: string | null; status: string | null }>(SQL_VIGENTE_SAPL, [chave]))[0];
    if (r) {
      m.set("base_url", r.base_url);
      m.set("status", r.status);
    }
  } else if (classe === "cobertura") {
    const ibge = chave.slice(0, chave.indexOf(":"));
    const dataset = chave.slice(chave.indexOf(":") + 1);
    const r = (await q<{ status: string | null; reason: string | null; evidence_url: string | null }>(SQL_VIGENTE_COBERTURA, [ibge, dataset]))[0];
    if (r) {
      m.set("status", r.status);
      m.set("reason", r.reason);
      m.set("evidence_url", r.evidence_url);
    }
  } else if (classe === "contato_mandato") {
    for (const c of await q<{ kind: string; value: string }>(SQL_VIGENTE_CONTATOS, [chave])) m.set(`${c.kind}:${c.value}`, c.value);
  } else {
    const r = (await q<{ status: string | null }>(SQL_VIGENTE_IDENTIDADE, [chave]))[0];
    if (r) m.set("status", r.status);
  }
  return m;
}

type PorCampo = { campo: string } & Linha;

/** A ficha: identificação e território; por campo, o valor vigente de AGORA (tabela de domínio), as propostas com evidência, a pendência com a pergunta, os pareceres e o histórico de decisões. */
export async function ficha(classe: string, chave: string) {
  exigirAdmin();
  if (!ehClasse(classe) || !chaveValida(classe, chave)) throw new ErroNaoEncontrado("ficha");
  return lendo(async (q) => {
    const base = (await q<LinhaFicha>(SQL_FICHA_BASE, [classe, chave]))[0];
    if (!base) throw new ErroNaoEncontrado("ficha");
    const t = territorioDe(classe, base.ibge_code, base.kind);
    const pendencias = await q<PorCampo>(SQL_FICHA_PENDENCIAS, [classe, chave]);
    const propostas = await q<PorCampo>(SQL_FICHA_PROPOSTAS, [classe, chave]);
    const decisoes = await q<PorCampo>(SQL_FICHA_DECISOES, [classe, chave]);
    const pareceres = await q<PorCampo>(SQL_FICHA_PARECERES, [classe, chave]);
    const pedidos = await q<PorCampo>(SQL_FICHA_PEDIDOS_DECISAO, [classe, chave]);
    const vigentes = await vigentesDe(q, classe, chave);
    const nomes = ordenadas([...new Set([...vigentes.keys(), ...[pendencias, propostas, decisoes, pareceres, pedidos].flatMap((l) => l.map((x) => x.campo))])]);
    const doCampo = (l: PorCampo[], campo: string) => l
        .filter((x) => x.campo === campo)
        .map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "campo")));
    return {
      classe,
      chave,
      rotulo: base.rotulo,
      territorio: t.territorio,
      motivoSemTerritorio: t.motivo,
      fontes: base.fontes ?? [],
      campos: nomes.map((campo) => ({
        campo,
        valorVigente: vigentes.has(campo) ? vigentes.get(campo) : null,
        pendencia: doCampo(pendencias, campo)[0] ?? null,
        propostas: doCampo(propostas, campo),
        decisoes: doCampo(decisoes, campo),
        pareceres: doCampo(pareceres, campo),
        pedidosDecisao: doCampo(pedidos, campo),
      })),
    };
  }, true);
}

// ---------------------------------------------------------------------------------------------------------------------------- rodadas

export async function rodadas(limite = 50) {
  exigirAdmin();
  if (!Number.isInteger(limite) || limite < 1 || limite > 200) throw new ErroPedidoInvalido("limite tem de ser um inteiro de 1 a 200");
  return lendo((q) => q(SQL_RODADAS, [limite]));
}

/** Cabeçalho da rodada (recorte, prévia, status) e os pedidos da fila ligados a ela. Os totais estão em `relatorioDaRodada`. */
export async function rodada(id: string) {
  exigirAdmin();
  if (!ehUuid(id)) throw new ErroNaoEncontrado("rodada");
  return lendo(async (q) => {
    const r = (await q<LinhaRodada>(SQL_RODADA, [id.toLowerCase()]))[0];
    if (!r) throw new ErroNaoEncontrado("rodada");
    return { ...r, pedidos: await q(SQL_RODADA_PEDIDOS, [r.id]) };
  }, true);
}

// ---------------------------------------------------------------------------------------------------------------------------- executor e mapa

/** Plano, seção 4a: executor parado = pedido na_fila há mais de 60 s, ou em_execucao com batimento mais velho que 120 s. */
export const LIMITE_FILA_S = 60;
export const LIMITE_BATIMENTO_S = 120;

export async function estadoDoExecutor() {
  exigirAdmin();
  return lendo(async (q) => {
    const e = (
      await q<{ na_fila: number; em_execucao: number; fila_mais_antiga_s: number | null; batimento_mais_antigo_s: number | null; ultimo_batimento_s: number | null; agora: unknown }>(
        SQL_EXECUTOR_ESTADO,
      )
    )[0];
    const motivos: string[] = [];
    if (e.fila_mais_antiga_s !== null && e.fila_mais_antiga_s > LIMITE_FILA_S) motivos.push(`pedido na fila há mais de ${LIMITE_FILA_S} s`);
    if (e.batimento_mais_antigo_s !== null && e.batimento_mais_antigo_s > LIMITE_BATIMENTO_S) motivos.push(`pedido em execução sem batimento há mais de ${LIMITE_BATIMENTO_S} s`);
    const porClasse: Record<string, number> = Object.fromEntries(CLASSES.map((c) => [c, 0]));
    for (const r of await q<{ classe: string; total: number }>(SQL_PENDENCIAS_ABERTAS_POR_CLASSE)) porClasse[r.classe] = r.total;
    return {
      agora: e.agora,
      executor: {
        naFila: e.na_fila,
        emExecucao: e.em_execucao,
        filaMaisAntigaS: e.fila_mais_antiga_s,
        batimentoMaisAntigoS: e.batimento_mais_antigo_s,
        ultimoBatimentoS: e.ultimo_batimento_s,
        parado: motivos.length > 0,
        motivoParado: motivos.length > 0 ? motivos.join("; ") : null,
      },
      pedidosRecentes: await q(SQL_PEDIDOS_RECENTES, [20]),
      rodadasEmCurso: await q(SQL_RODADAS_EM_CURSO),
      pendenciasAbertasPorClasse: porClasse,
    };
  }, true);
}

/** Contagens do mapa (por UF, sem território, conflitos), da MESMA agregação que desenha o mapa: sem unificação própria. */
export async function contagensDoMapa() {
  exigirAdmin();
  const ag = agregarPais(await fichas());
  return {
    total: ag.total,
    porUf: Object.fromEntries([...ag.porUf].map(([uf, c]) => [uf, c.total])),
    semTerritorio: { total: ag.semTerritorio.total, porMotivo: Object.fromEntries(Object.entries(ag.semTerritorio.porMotivo).map(([m, ids]) => [m, ids.length])) },
    conflitos: ag.conflitos.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------- pedidos (a única escrita)

export type PedidoGravado = { id: string; novo: boolean };

async function gravando(fn: (q: Consulta) => Promise<PedidoGravado>): Promise<PedidoGravado> {
  try {
    return await fn(consultaDe(sqlAdmin() as unknown as ComUnsafe));
  } catch (e) {
    if (e instanceof ErroDaCentral || e instanceof ErroPedidoInvalido) throw e;
    const codigo = codigoDe(e);
    console.error("[admin] erro ao gravar pedido:", codigo);
    if (codigo === "23503") throw new ErroPedidoInvalido("a pendência não existe");
    throw new ErroGravacaoBanco();
  }
}

/** insert ... where not exists; se já há pedido ativo com a chave, devolve o existente. A corrida entre dois insert cai no índice único (23505): lê o existente. */
async function inserirOuExistente(q: Consulta, inserir: string, existente: string, valores: Param[], chave: string): Promise<PedidoGravado> {
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const novo = await q<{ id: string }>(inserir, valores);
      if (novo[0]) return { id: novo[0].id, novo: true };
    } catch (e) {
      if (codigoDe(e) !== "23505") throw e;
    }
    const ja = await q<{ id: string }>(existente, [chave]);
    if (ja[0]) return { id: ja[0].id, novo: false };
    // o pedido ativo saiu da fila entre as duas leituras: tenta inserir de novo
  }
  throw new ErroGravacaoBanco();
}

/** Pedido de rodada, recoleta ou parecer. Parâmetros validados e normalizados; nada é aplicado aqui: o executor consome. Dois iguais enquanto o primeiro está ativo = mesmo id. */
export async function pedir(tipo: string, parametros: unknown): Promise<PedidoGravado> {
  exigirAdmin();
  const p = validarPedido(tipo, parametros);
  const chave = chaveIdemPedido(p.tipo, p.parametros);
  return gravando((q) => inserirOuExistente(q, SQL_PEDIDO_INSERIR, SQL_PEDIDO_EXISTENTE, [p.tipo, jsonCanonico(p.parametros), chave], chave));
}

/** Pedido de decisão (nunca a decisão: o executor valida e grava com `decisoes.decidir`). Exige `por` e `justificativa` não vazios. */
export async function pedirDecisao(corpo: unknown): Promise<PedidoGravado> {
  exigirAdmin();
  const d = validarDecisao(corpo);
  const chave = chaveIdemDecisao(d);
  return gravando((q) =>
    inserirOuExistente(
      q,
      SQL_PEDIDO_DECISAO_INSERIR,
      SQL_PEDIDO_DECISAO_EXISTENTE,
      [d.pendencia_id, d.acao, d.por_nome, d.justificativa, d.valor === undefined ? null : jsonCanonico(d.valor), d.aplicar, chave],
      chave,
    ),
  );
}

// ---------------------------------------------------------------------------------------------------------------------------- resposta de erro (route handlers)

const isControleDoNext = (e: unknown): boolean =>
  !!e && typeof e === "object" && "digest" in e && typeof (e as { digest: unknown }).digest === "string" && /^NEXT_(HTTP_ERROR_FALLBACK|NOT_FOUND|REDIRECT)/.test((e as { digest: string }).digest);

/** Erro tipado -> JSON sem detalhe técnico. Erro do próprio Next (notFound, redirect) é relançado; erro desconhecido vira 500 genérico. */
export function respostaDeErro(e: unknown): Response {
  if (isControleDoNext(e)) throw e;
  if (e instanceof ErroPedidoInvalido) return NextResponse.json({ erro: e.message }, { status: 400 });
  if (e instanceof ErroNaoEncontrado) return NextResponse.json({ erro: e.message }, { status: 404 });
  if (e instanceof ErroInvariante) return NextResponse.json({ erro: "os totais da rodada não fecham (rodada em andamento ou dado inconsistente)" }, { status: 409 });
  if (e instanceof ErroLeituraBanco || e instanceof ErroGravacaoBanco) return NextResponse.json({ erro: e.message }, { status: 503 });
  console.error("[admin] erro inesperado:", e instanceof Error ? e.name : typeof e);
  return NextResponse.json({ erro: "erro interno da central" }, { status: 500 });
}
