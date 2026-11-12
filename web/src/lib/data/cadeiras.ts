// Cadeiras por UF no Congresso e o placar de uma votação por UF. Puro: sem banco, importável pelos testes (node --test).
//
// As cadeiras são regra, não dado: NÃO se derivam de "quantos estão em exercício" (isso é carga, e hoje a carga tem 514 na
// Câmara por um bug do ETL). Câmara: a Lei Complementar 78/1993 fixa 513 deputados, no mínimo 8 e no máximo 70 por UF, e a
// Justiça Eleitoral distribui as cadeiras por UF; a distribuição vigente na 57ª legislatura (2023–2027) é a de `UF_ROWS`
// (reference.ts, coluna "cadeiras na Câmara"), a mesma que o seed de demonstração e o mapa usam. Uma redistribuição futura
// (por exemplo, pelo Censo 2022) muda essa tabela, não este código. Senado: CF art. 46 §1º, três por UF e pelo DF.
import { UF_ROWS } from "./reference.ts";
import type { Body, PlacarPorUf, PlacarUf, VoteValue } from "./types.ts";

export const TOTAL_CAMARA = 513;
export const SENADORES_POR_UF = 3;

/** Sigla → cadeiras na Câmara dos Deputados (LC 78/1993). */
export const CADEIRAS_CAMARA: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries(UF_ROWS.map((r) => [r[1], r[4]])));

export const FONTE_CADEIRAS: Record<Body, string> = {
  camara: "cadeiras por estado fixadas pela Lei Complementar 78/1993 (513 no total)",
  senado: "três cadeiras por estado e pelo Distrito Federal (Constituição, art. 46)",
};

/** Cadeiras da UF na casa; null = sigla desconhecida. */
export function cadeirasDaUf(casa: Body, uf: string): number | null {
  const u = uf.toUpperCase();
  if (!(u in CADEIRAS_CAMARA)) return null;
  return casa === "senado" ? SENADORES_POR_UF : CADEIRAS_CAMARA[u];
}

export const PORUF_MOTIVO = {
  secreta: "Votação secreta: a fonte não publica o voto de cada pessoa, então não há placar por estado.",
  semVotos: "A fonte não publicou o voto de cada pessoa nesta votação, então não há placar por estado.",
  /** sem flag da fonte: o banco só sabe que não há voto individual carregado, não por quê */
  semLinhas: "Não há voto individual carregado para esta votação, então não há placar por estado.",
} as const;

/** Por que um registro fica sem UF no placar: a UF só vale se o mandato da pessoa nesta casa cobre a data da votação. */
export const MOTIVO_SEM_UF = "sem mandato desta casa carregado para a data da votação";
/**
 * Acima desta fração de registros sem UF, o placar por UF não sustenta leitura (mandatos da legislatura da votação fora do
 * banco): vira lacuna nomeada inteira, nunca um placar quase vazio.
 */
export const LIMITE_SEM_UF = 0.1;
// Não diz "legislatura não carregada": no banco local, o resíduo é sobretudo de suplentes cujo período de exercício na data
// não foi carregado (o mandato carregado começa depois da votação), não de uma legislatura inteira.
export const motivoSemMandatos = (semUf: number, total: number) =>
  `Não temos carregado o mandato nesta casa, na data da votação, de ${semUf} dos ${total} registros (mais de um em cada dez), então não há placar por estado.`;

const zero = (): Record<VoteValue, number> => ({ sim: 0, nao: 0, abstencao: 0, obstrucao: 0, art17: 0, nao_votou: 0 });

/**
 * Placar por UF a partir dos votos individuais. Sem voto individual (secreta, aberta sem voto publicado ou nenhum registro):
 * lacuna com o motivo, nunca uma tabela de zeros. Uma linha por UF da casa (todas as 27), em ordem alfabética de sigla.
 * Registro com UF desconhecida vai para `semUf` (com o nome em `semUfNomes`, ordem alfabética). A soma de todas as linhas
 * mais `semUf` fecha com o total de registros. Mais de LIMITE_SEM_UF dos registros sem UF: lacuna `semMandatos`.
 * `uf` de cada voto deve ser a do mandato NESTA casa que cobre a data (nunca a de outro mandato ou cargo).
 */
export function placarPorUf(ev: { body: Body; isSecret?: boolean; openNoVotes?: boolean }, votos: { uf: string | null; value: VoteValue; name?: string }[]): PlacarPorUf {
  if (ev.isSecret) return { kind: "lacuna", motivo: PORUF_MOTIVO.secreta };
  if (ev.openNoVotes) return { kind: "lacuna", motivo: PORUF_MOTIVO.semVotos };
  if (votos.length === 0) return { kind: "lacuna", motivo: PORUF_MOTIVO.semLinhas };
  const by = new Map<string, PlacarUf>();
  for (const uf of Object.keys(CADEIRAS_CAMARA).sort()) by.set(uf, { uf, cadeiras: cadeirasDaUf(ev.body, uf)!, contagem: zero(), registros: 0 });
  let semUf = 0;
  const semUfNomes: string[] = [];
  for (const v of votos) {
    const row = v.uf ? by.get(v.uf.toUpperCase()) : undefined;
    if (!row) {
      semUf++;
      if (v.name) semUfNomes.push(v.name);
      continue;
    }
    row.contagem[v.value]++;
    row.registros++;
  }
  if (semUf / votos.length > LIMITE_SEM_UF) return { kind: "lacuna", motivo: motivoSemMandatos(semUf, votos.length), semMandatos: true };
  semUfNomes.sort((a, b) => a.localeCompare(b, "pt-BR"));
  return { kind: "placar", casa: ev.body, ufs: [...by.values()], semUf, semUfNomes, motivoSemUf: MOTIVO_SEM_UF, fonteCadeiras: FONTE_CADEIRAS[ev.body] };
}
