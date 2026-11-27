import Link from "next/link";
import type { Stamp, VoteValue, VotingEventSummary } from "@/lib/data";
import { fraseLida } from "./carimbo";
import { esferaDoCargo } from "./esfera";
import { FALHOU_LEITURA } from "./estados";
import { BODY_NAME, clip, fmtDate } from "./fmt";
import { FONTE_MANDATO } from "./pessoa/mandato-dados";
import { fraseResultado } from "./resultado";
import type { MarcadoNoTema, MarcadosNoTema } from "./tema-marcados";
import { agruparVotos, type Casa, type StatusFora } from "./tema-marcados-regra";
import { Lacuna, Nota, Quadro, VotoMarca } from "./ui";

// "Como votaram as pessoas que eu marquei?" na tela de um tema (D352).
// Cada pessoa tem o próprio bloco (título h3), em ordem alfabética, com os votos dela, a data de cada um e a fonte. Não há soma
// por pessoa, coluna lado a lado nem placar entre elas: comparar pessoas por contagem de votos viraria ranking.
// O voto aparece em forma e palavra (VotoMarca), nunca em cor. Quem não vota essas propostas é lacuna com nome.

/** Votos à vista por pessoa; os mais antigos ficam recolhidos (abrem sem JavaScript). */
export const A_VISTA = 5;

const NA: Record<Casa, string> = { camara: "na Câmara dos Deputados", senado: "no Senado Federal" };
const naCasa = (casas: Casa[]) => casas.map((c) => NA[c]).join(" e ") || "no Congresso";
const titulo = (v: VotingEventSummary) => clip(v.proposal?.summary || v.description, 140);
/** O que diz a fonte sobre o mandato que cobria a votação sem voto. */
const FORA_TEXTO: Record<StatusFora, string> = {
  licenciado: "O mandato consta como licenciado na fonte; quem está de licença não vota.",
  afastado: "O mandato consta como afastado na fonte; quem está afastado não vota.",
  renunciou: "O mandato consta como encerrado por renúncia na fonte; depois da saída não há voto. A data de fim que temos pode ser a prevista, não a da saída.",
  cassado: "O mandato consta como cassado na fonte; depois da cassação não há voto. A data de fim que temos pode ser a prevista, não a da cassação.",
};
/** O que se votou, pelo tipo que a fonte registra (texto principal ou destaque); sem tipo, nada é afirmado. */
const TIPO: Partial<Record<string, string>> = { texto: "Texto principal", destaque: "Destaque" };
const EXECUTIVO = new Set(["presidente", "vice_presidente", "governador", "vice_governador", "prefeito", "vice_prefeito"]);

/** Onde vota quem não tem mandato no Congresso, dito pelo cargo. Cargo fora da lista conhecida não ganha afirmação. */
function ondeVota(e: MarcadoNoTema): string {
  const m = e.mandato;
  const cargo = m?.officeName ?? "Este cargo";
  const lugar = m?.placeLabel ? ` (${m.placeLabel})` : "";
  switch (m?.office) {
    case "deputado_estadual":
      return `${cargo} vota na Assembleia Legislativa${lugar}, que não decide as propostas do Congresso.`;
    case "deputado_distrital":
      return `${cargo} vota na Câmara Legislativa do Distrito Federal, que não decide as propostas do Congresso.`;
    case "vereador":
      return `${cargo} vota na Câmara Municipal${lugar}, que não decide as propostas do Congresso.`;
    default:
      return m && EXECUTIVO.has(m.office)
        ? `${cargo}${lugar} é cargo do Executivo, e esta pessoa não teve mandato no Congresso nos dados que lemos.`
        : "Esta pessoa não teve mandato de deputado federal nem de senador nos dados que lemos.";
  }
}

/** O cargo que a tela cita, com fonte e período. */
function Cargo({ e }: { e: MarcadoNoTema }) {
  const m = e.mandato;
  if (!m) return <p className="sv-esf">Esfera: ainda não temos esse dado. Os dados não têm mandato desta pessoa.</p>;
  const periodo = m.endsOn ? `de ${fmtDate(m.startedOn)} a ${fmtDate(m.endsOn)}` : `desde ${fmtDate(m.startedOn)}`;
  return (
    <p className="sv-esf">
      Esfera: {esferaDoCargo(m.office) ?? "ainda não temos esse dado"}. Mandato {periodo}, conforme {FONTE_MANDATO[m.statusSource] ?? "a fonte oficial do mandato"}.
    </p>
  );
}

function Votos({ e, stamps }: { e: MarcadoNoTema; stamps: Record<Casa, Stamp | null> }) {
  const s = e.situacao;
  if (s.tipo === "lacuna") {
    switch (s.motivo) {
      case "nao_vota_no_congresso":
        return <Lacuna motivo={ondeVota(e)}>Não vota nestas votações.</Lacuna>;
      case "outra_casa":
        return <Lacuna motivo={`As votações deste tema que lemos não são ${naCasa(s.casas)}, onde está o mandato desta pessoa no Congresso.`}>Não vota nestas votações.</Lacuna>;
      case "aguarda_posse":
        return <Lacuna motivo="Foi eleita ou eleito e ainda não tomou posse. Só há voto depois da posse.">Ainda não vota.</Lacuna>;
      case "fora_do_mandato":
        return <Lacuna motivo={`Nenhum mandato desta pessoa ${naCasa(s.casas)} valia nas datas das votações deste tema que lemos.`}>Não votou nestas votações.</Lacuna>;
      case "sem_voto_individual":
        return <Lacuna motivo={`As votações deste tema que lemos ${naCasa(s.casas)}, nas datas do mandato, foram secretas ou sem voto de cada pessoa publicado.`}>A fonte não publicou o voto de cada pessoa.</Lacuna>;
      case "fora_do_exercicio":
        return <Lacuna motivo={`${FORA_TEXTO[s.statusFora!]} A fonte não traz voto de ${e.nome} nas votações deste tema que lemos ${naCasa(s.casas)}.`}>Sem voto registrado nestas votações.</Lacuna>;
      case "sem_registro":
        return <Lacuna motivo={`A fonte não traz voto de ${e.nome} nas votações deste tema que lemos ${naCasa(s.casas)}. Sem voto não é voto contra.`}>Sem voto registrado nestas votações.</Lacuna>;
      case "sem_mandato":
        return <Lacuna motivo="Sem o mandato não dá para dizer se vota nestas votações.">Os dados não têm mandato desta pessoa.</Lacuna>;
      default:
        return <Lacuna motivo={`Os votos de ${e.nome} não puderam ser lidos agora. Tente de novo em alguns minutos.`}>{FALHOU_LEITURA}</Lacuna>;
    }
  }
  // Data, voto e o que se votou: o tipo registrado pela fonte (texto principal ou destaque), o rótulo, a Casa e o resultado.
  // Votações iguais na tela (mesmo dia, proposta, tipo e voto) viram uma linha que leva a cada uma (como a D328).
  const linha = ({ votacao: v, voto, votacoes }: ReturnType<typeof agruparVotos<VotingEventSummary, VoteValue>>[number]) => (
    <li key={v.id}>
      <span className="sv-tm1-vd">{fmtDate(v.occurredAt)}</span> <VotoMarca voto={voto} /> em{" "}
      {votacoes.length === 1 ? <Link href={`/votacao/${v.id}`}>{titulo(v)}</Link> : titulo(v)}
      <span className="sv-tm1-vk">
        {v.proposal?.label ? `${v.proposal.label}. ` : ""}
        {v.kind && TIPO[v.kind] ? `${TIPO[v.kind]}. ` : ""}
        {BODY_NAME[v.body]}.{" "}
        {votacoes.length === 1 ? (
          fraseResultado(v)
        ) : (
          <>
            Mesmo voto em {votacoes.length} votações desta proposta neste dia:{" "}
            {votacoes.map((x, i) => (
              <span key={x.id}>
                {i > 0 && ", "}
                <Link href={`/votacao/${x.id}`}>votação {i + 1}</Link>
              </span>
            ))}
            .
          </>
        )}
      </span>
    </li>
  );
  const grupos = agruparVotos(s.votos, (v) => v.proposal?.label || v.description);
  const aVista = grupos.slice(0, A_VISTA);
  const resto = grupos.slice(A_VISTA);
  return (
    <>
      <ul className="sv-tm1-votos">{aVista.map(linha)}</ul>
      {resto.length > 0 && (
        <details>
          <summary>Ver os votos mais antigos de {e.nome} neste tema</summary>
          <ul className="sv-tm1-votos">{resto.map(linha)}</ul>
        </details>
      )}
      {s.semRegistroEmOutras && (
        <p className="sv-nota">
          Em outras votações deste tema, nas datas do mandato, a fonte não traz voto de {e.nome}. {s.statusFora ? FORA_TEXTO[s.statusFora] : "Sem voto não é voto contra."}
        </p>
      )}
      <p className="sv-fonte">Fonte: {s.casas.map((c) => `${BODY_NAME[c]}, votações nominais${fraseLida(stamps[c], "as")}`).join("; ")}.</p>
    </>
  );
}

const PERGUNTA = "Como votaram as pessoas que eu marquei?";

export function MarcadosNoTemaQuadro({ id, numero, tema, r, stamps, className }: { id: string; numero: number; tema: string; r: MarcadosNoTema; stamps: Record<Casa, Stamp | null>; className?: string }) {
  if (r.estado === "vazio")
    return (
      <Quadro id={id} numero={numero} pergunta={PERGUNTA} className={className}>
        <p className="sv-t">Você ainda não marcou ninguém. Marque as pessoas em quem você votou para ver aqui como elas votaram sobre {tema}.</p>
        <Link className="sv-lk" href="/pessoas">
          Escolher em quem votei <span aria-hidden="true">→</span>
        </Link>
      </Quadro>
    );
  if (r.estado === "falhou")
    return (
      <Quadro id={id} variante="lacuna" numero={numero} pergunta={PERGUNTA} className={className}>
        <Lacuna motivo="Tente de novo em alguns minutos. Suas marcações continuam guardadas.">{FALHOU_LEITURA}</Lacuna>
      </Quadro>
    );
  const prova = r.pessoas.length
    ? "Pessoas em ordem alfabética. Cada voto traz a data da votação e a fonte, no bloco de cada pessoa; o cargo traz o mandato e a fonte dele. Um voto conta quando o mandato no Congresso valia na data da votação."
    : undefined;
  return (
    <Quadro id={id} variante={r.pessoas.length ? "padrao" : "lacuna"} numero={numero} pergunta={PERGUNTA} className={className} prova={prova}>
      {r.pessoas.length > 0 && (
        <>
          <Nota>Cada pessoa aparece com os próprios votos nas votações deste tema, da mais recente para a mais antiga. Não somamos nem comparamos: quem votou mais ou menos vezes não é melhor nem pior.</Nota>
          <ul className="sv-pes sv-tm1-esc">
            {r.pessoas.map((e) => (
              <li key={e.slug}>
                <h3 className="sv-tm1-pn">
                  <Link href={`/pessoa/${e.slug}`}>{e.nome}</Link>
                  {e.mandato ? `, ${e.mandato.officeName}` : ""}
                  {e.mandato?.placeLabel ? ` (${e.mandato.placeLabel})` : ""}
                </h3>
                <Cargo e={e} />
                <Votos e={e} stamps={stamps} />
              </li>
            ))}
          </ul>
        </>
      )}
      {r.naoEncontradas > 0 && (
        <Lacuna motivo="Pode ser pessoa que saiu dos dados ou um endereço que mudou.">
          {r.naoEncontradas === 1 ? "1 marcação guardada não é de nenhuma pessoa dos dados de hoje." : `${r.naoEncontradas} marcações guardadas não são de nenhuma pessoa dos dados de hoje.`}
        </Lacuna>
      )}
    </Quadro>
  );
}
