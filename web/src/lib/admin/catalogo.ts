// Catálogo de coletores na tela (funções puras). Os DADOS vêm de catalogo.json, gerado de etl/civico_etl/catalogo por web/e2e-admin/gerar-catalogo.mjs; as funções recebem o catálogo
// por parâmetro (o componente importa o JSON; os testes leem o arquivo). O formulário de "Abrir rodada" só oferece o que o catálogo declara: coletor, modos suportados e recortes aceitos.
import { descreverRecorte, modoDaRodada, nomeDaUf, UFS } from "./rotulos.ts";

export type ColetorCatalogo = {
  id: string;
  /** o catálogo não tem rótulo legível: é o próprio id */
  rotulo: string;
  territorio: string;
  fontes: string[];
  modos: string[];
  modos_recusados: Record<string, string>;
  /** recortes aceitos, pelos nomes do catálogo: ano, uf, casa, ibge e extras (ex.: escopo) */
  recortes: string[];
  exige_chave: boolean;
};
export type Catalogo = { fonte: string; coletores: ColetorCatalogo[] };

/** Valores do recorte extra `escopo`: o parser aceita capitais ou todas (etl/civico_etl/catalogo/contrato.py:192-196). Não está no catálogo como dado: vive aqui, com esta referência. */
export const OPCOES_ESCOPO = ["capitais", "todas"] as const;
export const ROTULO_ESCOPO: Readonly<Record<string, string>> = { capitais: "Só as capitais (padrão da CLI)", todas: "Todos os municípios" };
/** Nomes de recorte do catálogo que a tela sabe desenhar; outro nome aceito pelo coletor aparece como "recorte sem campo na tela" (a CLI atende). */
export const RECORTES_NA_TELA = ["ano", "uf", "casa", "ibge", "escopo"] as const;

export const TERRITORIO_DO_COLETOR: Readonly<Record<string, string>> = { pais: "país inteiro", uf: "por estado", municipio: "por município", nenhuma: "sem recorte territorial" };

export const coletorDoCatalogo = (cat: Catalogo, id: string): ColetorCatalogo | null => cat.coletores.find((c) => c.id === id) ?? null;

/** Recortes que o coletor aceita e que a tela desenha, e os que ele aceita mas a tela não desenha. */
export function recortesDoColetor(c: ColetorCatalogo): { naTela: string[]; foraDaTela: string[] } {
  const naTela = c.recortes.filter((r) => (RECORTES_NA_TELA as readonly string[]).includes(r));
  return { naTela, foraDaTela: c.recortes.filter((r) => !naTela.includes(r)) };
}

export type EntradaRodada = { coletor: string; modo: string; anos: string; ufs: string[]; casas: string; ibges: string; escopo: string };
export type ParametrosRodada = { coletor: string; modo: string; recorte?: { anos?: number[]; ufs?: string[]; casas?: string[]; ibges?: string[]; extras?: Record<string, string> } };
export type ResultadoRodada = { ok: true; parametros: ParametrosRodada } | { ok: false; erro: string };

const separar = (t: string): string[] => t.split(/[\s,;]+/).filter(Boolean);

/** Valida o formulário contra o catálogo e monta `parametros` do pedido de rodada (a mesma forma que validarPedido espera). Nunca monta recorte que o coletor não aceita. */
export function validarRodada(cat: Catalogo, e: EntradaRodada): ResultadoRodada {
  const c = coletorDoCatalogo(cat, e.coletor);
  if (!c) return { ok: false, erro: "Escolha um coletor da lista." };
  if (!c.modos.includes(e.modo)) return { ok: false, erro: c.modos_recusados[e.modo] ? `${modoDaRodada(e.modo)} não vale para ${c.id}: ${c.modos_recusados[e.modo]}.` : "Escolha um modo que o coletor suporte." };
  const recorte: NonNullable<ParametrosRodada["recorte"]> = {};
  const aceitos = new Set(c.recortes);
  const anos = separar(e.anos);
  if (anos.length > 0) {
    if (!aceitos.has("ano")) return { ok: false, erro: `${c.id} não aceita recorte por ano.` };
    const nums = anos.map(Number);
    if (nums.some((n) => !Number.isInteger(n) || n < 1900 || n > 2100)) return { ok: false, erro: "Ano tem 4 dígitos, entre 1900 e 2100, separados por vírgula." };
    recorte.anos = [...new Set(nums)].sort((a, b) => a - b);
  }
  if (e.ufs.length > 0) {
    if (!aceitos.has("uf")) return { ok: false, erro: `${c.id} não aceita recorte por estado.` };
    if (e.ufs.some((u) => !UFS.some((x) => x.sigla === u))) return { ok: false, erro: "Estado desconhecido no recorte." };
    recorte.ufs = [...e.ufs].sort();
  }
  const casas = separar(e.casas);
  if (casas.length > 0) {
    if (!aceitos.has("casa")) return { ok: false, erro: `${c.id} não aceita recorte por casa.` };
    recorte.casas = [...new Set(casas)];
  }
  const ibges = separar(e.ibges);
  if (ibges.length > 0) {
    if (!aceitos.has("ibge")) return { ok: false, erro: `${c.id} não aceita recorte por município.` };
    if (ibges.some((i) => !/^\d{7}$/.test(i))) return { ok: false, erro: "Código IBGE de município tem 7 dígitos." };
    recorte.ibges = [...new Set(ibges)];
  }
  if (e.escopo !== "") {
    if (!aceitos.has("escopo")) return { ok: false, erro: `${c.id} não aceita escopo.` };
    if (!(OPCOES_ESCOPO as readonly string[]).includes(e.escopo)) return { ok: false, erro: "Escopo: capitais ou todas." };
    if (recorte.ibges) return { ok: false, erro: "O escopo é ignorado quando há município por código IBGE: peça um ou outro." }; // contrato.py:195-196
    recorte.extras = { escopo: e.escopo };
  }
  const parametros: ParametrosRodada = { coletor: c.id, modo: e.modo };
  if (Object.keys(recorte).length > 0) parametros.recorte = recorte;
  return { ok: true, parametros };
}

/** O recorte de `parametros` como texto para a confirmação. */
export const textoDoRecorte = (p: ParametrosRodada): string => descreverRecorte(p.recorte ?? null);

export const nomesDasUfs = (siglas: readonly string[]): string => siglas.map(nomeDaUf).join(", ");
