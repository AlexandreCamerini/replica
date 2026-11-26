// Como votaram, nas votações de um tema, as pessoas que o leitor marcou (D352). Leitura no servidor; a regra do que
// mostrar para cada pessoa está em tema-marcados-regra.ts.
import "server-only";
import { data, type Mandate, type VoteValue, type VotingEventSummary } from "@/lib/data";
import { compararNomes } from "@/lib/ordem-nomes";
import { situacaoNoTema, temMandatoNoCongresso, type SituacaoNoTema } from "./tema-marcados-regra";

/** O mandato que a tela cita como cargo (o principal: o contrato entrega primeiro o em exercício, depois o aguardando posse). */
export type MandatoCitado = Pick<Mandate, "office" | "status" | "startedOn" | "endsOn" | "statusSource"> & { officeName: string; placeLabel: string };

export type MarcadoNoTema = {
  slug: string;
  nome: string;
  /** null = os dados não têm mandato desta pessoa */
  mandato: MandatoCitado | null;
  situacao: SituacaoNoTema<VotingEventSummary, VoteValue>;
};

export type MarcadosNoTema =
  /** o cookie não tem ninguém */
  | { estado: "vazio" }
  /** a leitura das pessoas (ou dos mandatos) falhou: não dá para dizer quem são. `marcadas`: marcações guardadas, não pessoas */
  | { estado: "falhou"; marcadas: number }
  /** `naoEncontradas`: marcações que não são de nenhuma pessoa dos dados de hoje */
  | { estado: "lido"; pessoas: MarcadoNoTema[]; naoEncontradas: number };

/**
 * `ler`: embrulha cada leitura (na demonstração, `?simular=` faz falhar). `lerVotos` separa a falha dos votos da falha de saber
 * quem são as pessoas.
 * Três leituras em lote, qualquer que seja o número de pessoas: pessoas, mandatos e os votos delas nas votações que a tela do
 * tema lista (por id). Voto de votação fora dessa lista não entra; nada é truncado por limite de página.
 */
export async function carregarMarcadosNoTema(
  slugs: readonly string[],
  tema: { events: VotingEventSummary[] },
  ler: <T>(fn: () => Promise<T>) => Promise<T> = (fn) => fn(),
  lerVotos: <T>(fn: () => Promise<T>) => Promise<T> = ler,
): Promise<MarcadosNoTema> {
  if (slugs.length === 0) return { estado: "vazio" };
  // ordenados: a mesma lista dá a mesma chave de cache
  const achadas = await ler(() => data.getPeopleBySlugs([...slugs].sort())).catch(() => null);
  if (!achadas) return { estado: "falhou", marcadas: slugs.length };
  // a mesma pessoa pelo endereço antigo e pelo atual conta uma vez (D327)
  const vistos = new Set<string>();
  const pessoas = achadas.encontradas.map((e) => e.person).filter((p) => !vistos.has(p.id) && !!vistos.add(p.id));
  if (pessoas.length === 0) return { estado: "lido", pessoas: [], naoEncontradas: achadas.naoEncontradas.length };
  const ids = pessoas.map((p) => p.id).sort();
  const mandatos = await ler(() => data.getMandatesForPeople(ids)).catch(() => null);
  if (!mandatos) return { estado: "falhou", marcadas: pessoas.length };

  const doCongresso = ids.filter((id) => temMandatoNoCongresso(mandatos[id] ?? []));
  const eventIds = tema.events.map((e) => e.id).sort();
  const votos =
    doCongresso.length && eventIds.length
      ? await lerVotos(() => data.getVotesForPeopleInEvents(doCongresso, eventIds)).catch(() => null)
      : {};

  const lista = pessoas.map((p): MarcadoNoTema => {
    const ms = mandatos[p.id] ?? [];
    const m = ms[0] ?? null;
    const dela = votos === null ? null : (votos[p.id] ?? []).map((v) => ({ eventId: v.eventId, voto: v.value }));
    return {
      slug: p.slug,
      nome: p.displayName,
      mandato: m && { office: m.office, status: m.status, startedOn: m.startedOn, endsOn: m.endsOn, statusSource: m.statusSource, officeName: m.officeName, placeLabel: m.placeLabel },
      situacao: situacaoNoTema(ms, tema.events, dela),
    };
  });
  return { estado: "lido", pessoas: lista.sort((a, b) => compararNomes(a.nome, b.nome)), naoEncontradas: achadas.naoEncontradas.length };
}
