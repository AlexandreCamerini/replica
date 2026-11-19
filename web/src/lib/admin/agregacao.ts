// Agregação pura de fichas por território, para o mapa da central. Sem I/O, determinística.
// Importável pelos testes (node --test): imports com extensão `.ts`, sem `@/`, sem `server-only`.
import { CLASSES, MOTIVOS_SEM_MAPA, TEXTO_MOTIVO } from "./tipos.ts";
import type {
  AgregacaoPais,
  AgregacaoUf,
  Conflito,
  Contagem,
  Ficha,
  FiltroRegistros,
  MotivoSemMapa,
  RegistroLista,
  Territorio,
} from "./tipos.ts";

export const chaveDaFicha = (f: Pick<Ficha, "classe" | "chave">): string => `${f.classe}:${f.chave}`;

/** UF (2 dígitos) de um código IBGE de 7 dígitos (município) ou de 2 dígitos (a própria UF). Inválido: null. */
export function ufDoIbge(ibge: string): string | null {
  if (typeof ibge !== "string" || !/^\d+$/.test(ibge)) return null;
  if (ibge.length === 7 || ibge.length === 2) return ibge.slice(0, 2);
  return null;
}

/** Ordem fixa: classe, depois chave. Nunca rótulo, nome, pessoa ou partido. */
export function compararFichas(a: Pick<Ficha, "classe" | "chave">, b: Pick<Ficha, "classe" | "chave">): number {
  const d = CLASSES.indexOf(a.classe) - CLASSES.indexOf(b.classe);
  if (d !== 0) return d;
  return a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0;
}

type Unica = { id: string; ficha: Ficha; ponto: { uf: string; municipio: string | null } | null; motivo: MotivoSemMapa | null };

const mesmoTerritorio = (a: Territorio | null, b: Territorio | null): boolean =>
  a === null || b === null ? a === b : a.ibge === b.ibge && a.nivel === b.nivel;

/** Território utilizável no mapa; ibge ou nível inválidos viram "não resolvido". */
function pontoDe(t: Territorio): { uf: string; municipio: string | null } | "pais" | null {
  if (t.nivel === "pais") return "pais";
  const uf = ufDoIbge(t.ibge);
  if (uf === null) return null;
  if (t.nivel === "municipio") return t.ibge.length === 7 ? { uf, municipio: t.ibge } : null;
  if (t.nivel === "uf") return t.ibge.length === 2 ? { uf, municipio: null } : null;
  return null;
}

function unificar(fichas: readonly Ficha[]): { unicas: Unica[]; conflitos: Conflito[] } {
  const grupos = new Map<string, Ficha[]>();
  for (const f of fichas) {
    const id = chaveDaFicha(f);
    const g = grupos.get(id);
    if (g) g.push(f);
    else grupos.set(id, [f]);
  }
  const unicas: Unica[] = [];
  const conflitos: Conflito[] = [];
  for (const [id, g] of grupos) {
    const base = g[0];
    const fontes = [...new Set(g.flatMap((f) => f.fontes))];
    const ficha: Ficha = { ...base, fontes };
    if (g.some((f) => !mesmoTerritorio(f.territorio, base.territorio))) {
      const territorios: Territorio[] = [];
      for (const f of g) if (f.territorio && !territorios.some((t) => mesmoTerritorio(t, f.territorio))) territorios.push(f.territorio);
      const resolvida: Ficha = { ...ficha, territorio: null, motivoSemTerritorio: "territorio_nao_resolvido" };
      conflitos.push({ id, ficha: resolvida, territorios });
      unicas.push({ id, ficha: resolvida, ponto: null, motivo: "territorio_nao_resolvido" });
      continue;
    }
    const semPonto = (motivo: MotivoSemMapa): Unica => ({ id, ficha, ponto: null, motivo });
    if (base.classe === "identidade") {
      unicas.push(semPonto("classe_sem_territorio"));
    } else if (base.territorio === null) {
      unicas.push(semPonto(base.motivoSemTerritorio ?? "territorio_nao_resolvido"));
    } else {
      const p = pontoDe(base.territorio);
      if (p === "pais") unicas.push(semPonto("alcance_nacional"));
      else if (p === null) unicas.push(semPonto("territorio_nao_resolvido"));
      else unicas.push({ id, ficha, ponto: p, motivo: null });
    }
  }
  unicas.sort((a, b) => compararFichas(a.ficha, b.ficha));
  conflitos.sort((a, b) => compararFichas(a.ficha, b.ficha));
  return { unicas, conflitos };
}

const novaContagem = (): Contagem => ({ total: 0, ids: [] });
const somar = (c: Contagem, id: string): void => {
  c.total += 1;
  c.ids.push(id);
};
const ordenarMapa = (m: Map<string, Contagem>): Map<string, Contagem> => new Map([...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function agregarPais(fichas: readonly Ficha[]): AgregacaoPais {
  const { unicas, conflitos } = unificar(fichas);
  const porUf = new Map<string, Contagem>();
  const porMotivo = Object.fromEntries(MOTIVOS_SEM_MAPA.map((m) => [m, [] as string[]])) as Record<MotivoSemMapa, string[]>;
  const sem = { ...novaContagem(), porMotivo };
  for (const u of unicas) {
    if (u.ponto) {
      let c = porUf.get(u.ponto.uf);
      if (!c) porUf.set(u.ponto.uf, (c = novaContagem()));
      somar(c, u.id);
    } else {
      somar(sem, u.id);
      porMotivo[u.motivo ?? "territorio_nao_resolvido"].push(u.id);
    }
  }
  return { porUf: ordenarMapa(porUf), semTerritorio: sem, total: unicas.length, conflitos };
}

export function agregarUf(fichas: readonly Ficha[], ufIbge: string): AgregacaoUf {
  const { unicas } = unificar(fichas);
  const porMunicipio = new Map<string, Contagem>();
  const daUf = novaContagem();
  let total = 0;
  for (const u of unicas) {
    if (!u.ponto || u.ponto.uf !== ufIbge) continue;
    total += 1;
    if (u.ponto.municipio === null) somar(daUf, u.id);
    else {
      let c = porMunicipio.get(u.ponto.municipio);
      if (!c) porMunicipio.set(u.ponto.municipio, (c = novaContagem()));
      somar(c, u.id);
    }
  }
  return { porMunicipio: ordenarMapa(porMunicipio), daUfSemMunicipio: daUf, total };
}

/**
 * Lista "Ver registros". Sem filtro ou nivel "pais": todas as fichas. Com UF: as fichas daquela UF mais as sem ponto no mapa.
 * Com município: as do município, as de UF da UF dele (aproximadas) e as sem ponto no mapa.
 * As sem ponto no mapa entram sempre, com o motivo escrito (critério 18).
 */
export function verRegistros(fichas: readonly Ficha[], filtro?: FiltroRegistros): RegistroLista[] {
  const { unicas } = unificar(fichas);
  const saida: RegistroLista[] = [];
  for (const u of unicas) {
    if (!u.ponto) {
      const motivo = u.motivo ?? "territorio_nao_resolvido";
      saida.push({ id: u.id, ficha: u.ficha, motivo, textoMotivo: TEXTO_MOTIVO[motivo], aproximada: false });
      continue;
    }
    const aprox = u.ponto.municipio === null;
    if (!filtro || filtro.nivel === "pais") saida.push({ id: u.id, ficha: u.ficha, aproximada: false });
    else if (filtro.nivel === "uf") {
      if (u.ponto.uf === filtro.ibge) saida.push({ id: u.id, ficha: u.ficha, aproximada: false });
    } else {
      const uf = ufDoIbge(filtro.ibge);
      if (u.ponto.municipio === filtro.ibge) saida.push({ id: u.id, ficha: u.ficha, aproximada: false });
      else if (aprox && uf !== null && u.ponto.uf === uf) saida.push({ id: u.id, ficha: u.ficha, aproximada: true });
    }
  }
  return saida;
}

/** "1 ficha", "2 fichas", "0 fichas": o número sempre escrito. */
export function formatarContagem(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`contagem inválida: ${n}`);
  return n === 1 ? "1 ficha" : `${n} fichas`;
}
