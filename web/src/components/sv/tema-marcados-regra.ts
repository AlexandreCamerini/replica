// Como as pessoas marcadas votaram nas votações de um tema (D352): a regra que decide, para cada pessoa, o que a tela
// mostra. Puro (sem servidor nem React), para o teste unitário.
//
// As votações de um tema são do Congresso: da Câmara dos Deputados ou do Senado. Só deputado federal e senador votam
// ali, cada um na sua Casa, e só enquanto o mandato vale. Por isso a regra olha TODOS os mandatos da pessoa e a data de
// cada votação, não o cargo de hoje: o deputado que virou governador votou na Câmara até o fim do mandato, e esse voto
// continua dele. Para o resto a resposta é uma lacuna com nome. Nunca zero, nunca vazio.

export type Casa = "camara" | "senado";
export type VotacaoDoTema = { id: string; body: Casa; occurredAt: string; isSecret?: boolean; openNoVotes?: boolean };
/** Um mandato da pessoa, de qualquer cargo e época. `endsOn` vazio = sem fim registrado. */
export type MandatoDaPessoa = { office: string; status: string | null; startedOn: string; endsOn: string | null };
/** O voto de uma pessoa numa votação; `T` é o que a fonte entrega. */
export type VotoLido<T> = { eventId: string; voto: T };

export type MotivoDaLacuna =
  /** nenhum mandato de deputado federal ou senador */
  | "nao_vota_no_congresso"
  /** tem mandato no Congresso, mas as votações deste tema são todas da outra Casa */
  | "outra_casa"
  /** eleita para o Congresso e ainda sem posse, sem mandato anterior que cubra as votações */
  | "aguarda_posse"
  /** tem mandato na Casa, mas nenhum cobria a data das votações deste tema */
  | "fora_do_mandato"
  /** o mandato cobria as votações, mas todas foram secretas ou sem voto individual publicado */
  | "sem_voto_individual"
  /** o mandato cobria votações com voto individual publicado e a fonte não traz voto dela */
  | "sem_registro"
  /** como "sem_registro", mas o mandato consta como licenciado, afastado, renunciado ou cassado (`statusFora`) */
  | "fora_do_exercicio"
  /** os dados não têm mandato desta pessoa */
  | "sem_mandato"
  | "leitura_falhou";

export type SituacaoNoTema<V extends VotacaoDoTema, T> =
  /** voto registrado em votações deste tema, da mais recente para a mais antiga; `casas`: de onde vêm os votos e as lacunas */
  | { tipo: "votou"; votos: { votacao: V; voto: T }[]; /** votações com voto individual, cobertas por mandato dela, sem voto dela */ semRegistroEmOutras: boolean; casas: Casa[]; statusFora: StatusFora | null }
  | { tipo: "lacuna"; motivo: MotivoDaLacuna; casas: Casa[]; statusFora?: StatusFora };

/** Situação do mandato que explica a falta de voto. Renúncia e cassação: o fim registrado pode ser o previsto, não o real. */
export type StatusFora = "licenciado" | "afastado" | "renunciou" | "cassado";
const FORA: ReadonlySet<string> = new Set<StatusFora>(["licenciado", "afastado", "renunciou", "cassado"]);

const CASA_DO_CARGO: Record<string, Casa> = { deputado_federal: "camara", senador: "senado" };
const DIA_SP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

/** Dia da votação no fuso de Brasília (a data do mandato é civil, sem hora). */
export function diaDaVotacao(occurredAt: string): string {
  const d = new Date(occurredAt);
  return Number.isNaN(d.getTime()) ? occurredAt.slice(0, 10) : DIA_SP.format(d);
}

/** O mandato vale na data? Início e fim inclusive; fim vazio = sem fim. Mandato sem início registrado não cobre nada. */
export const cobre = (m: MandatoDaPessoa, dia: string) => !!m.startedOn && m.startedOn <= dia && (!m.endsOn || dia <= m.endsOn);

const casasDe = (vs: readonly { body: Casa }[]): Casa[] => (["camara", "senado"] as const).filter((c) => vs.some((v) => v.body === c));

/** Tem algum mandato no Congresso (de qualquer época)? Só para essas pessoas os votos são lidos. */
export const temMandatoNoCongresso = (mandatos: readonly MandatoDaPessoa[]) => mandatos.some((m) => !!CASA_DO_CARGO[m.office]);

/**
 * `mandatos`: todos os mandatos da pessoa. `votos`: os votos dela nas votações do tema; null = a leitura falhou.
 * Voto que a fonte publicou vale mesmo sem mandato carregado na data (o dado da fonte não é descartado por falta do nosso).
 */
export function situacaoNoTema<V extends VotacaoDoTema, T>(mandatos: readonly MandatoDaPessoa[], votacoes: readonly V[], votos: readonly VotoLido<T>[] | null): SituacaoNoTema<V, T> {
  if (mandatos.length === 0) return { tipo: "lacuna", motivo: "sem_mandato", casas: [] };
  const federais = mandatos.filter((m) => !!CASA_DO_CARGO[m.office]);
  if (federais.length === 0) return { tipo: "lacuna", motivo: "nao_vota_no_congresso", casas: [] };
  const casasDoMandato = (["camara", "senado"] as const).filter((c) => federais.some((m) => CASA_DO_CARGO[m.office] === c));
  if (votos === null) return { tipo: "lacuna", motivo: "leitura_falhou", casas: casasDoMandato };

  const porVotacao = new Map(votos.map((v) => [v.eventId, v.voto]));
  const comVoto = votacoes.filter((v) => porVotacao.has(v.id)).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id));
  const naData = votacoes.filter((v) => federais.some((m) => CASA_DO_CARGO[m.office] === v.body && cobre(m, diaDaVotacao(v.occurredAt))));
  const comVotoIndividual = naData.filter((v) => !v.isSecret && !v.openNoVotes);
  const semRegistro = comVotoIndividual.filter((v) => !porVotacao.has(v.id));
  // o mandato que cobria uma votação sem voto consta fora do exercício? (o primeiro, na ordem do contrato)
  const statusFora =
    (federais.find((m) => m.status && FORA.has(m.status) && semRegistro.some((v) => CASA_DO_CARGO[m.office] === v.body && cobre(m, diaDaVotacao(v.occurredAt))))?.status as StatusFora | undefined) ?? null;

  if (comVoto.length > 0)
    return { tipo: "votou", votos: comVoto.map((votacao) => ({ votacao, voto: porVotacao.get(votacao.id)! })), semRegistroEmOutras: semRegistro.length > 0, casas: casasDe([...comVoto, ...semRegistro]), statusFora };
  if (semRegistro.length > 0)
    return statusFora ? { tipo: "lacuna", motivo: "fora_do_exercicio", casas: casasDe(semRegistro), statusFora } : { tipo: "lacuna", motivo: "sem_registro", casas: casasDe(semRegistro) };
  if (naData.length > 0) return { tipo: "lacuna", motivo: "sem_voto_individual", casas: casasDe(naData) };
  if (!votacoes.some((v) => casasDoMandato.includes(v.body))) return { tipo: "lacuna", motivo: "outra_casa", casas: casasDoMandato };
  if (federais.some((m) => m.status === "eleito_aguardando_posse")) return { tipo: "lacuna", motivo: "aguarda_posse", casas: casasDoMandato };
  return { tipo: "lacuna", motivo: "fora_do_mandato", casas: casasDoMandato };
}

/**
 * Junta os votos que a tela escreveria iguais (como a D328 em "O que fizeram por último"): numa sessão a mesma proposta tem
 * várias votações nominais com o mesmo tipo, e a pessoa vota igual em todas. Mesmo dia (em Brasília), mesma proposta
 * (`chave`), mesmo tipo e mesmo voto viram uma linha, que leva a cada votação. Voto diferente na mesma proposta não junta.
 * Mantém a ordem (mais recente primeiro); o grupo fica na posição do seu voto mais recente.
 */
export function agruparVotos<V extends VotacaoDoTema & { kind?: string }, T>(
  votos: readonly { votacao: V; voto: T }[],
  chave: (v: V) => string,
): { votacao: V; voto: T; votacoes: V[] }[] {
  const grupos = new Map<string, { votacao: V; voto: T; votacoes: V[] }>();
  for (const { votacao, voto } of votos) {
    const k = [diaDaVotacao(votacao.occurredAt), votacao.body, chave(votacao), votacao.kind ?? "", String(voto)].join("\u0000");
    const g = grupos.get(k);
    if (g) g.votacoes.push(votacao);
    else grupos.set(k, { votacao, voto, votacoes: [votacao] });
  }
  return [...grupos.values()].map((g) => ({ ...g, votacoes: [...g.votacoes].reverse() })); // dentro do grupo, da primeira à última do dia
}
