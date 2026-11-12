import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/sv-decisoes.css";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FALHOU_LEITURA, SEM_DADO } from "@/components/sv/estados";
import { clip, fmtDate, fmtDateTime, fmtInt } from "@/components/sv/fmt";
import { NotaRegra } from "@/components/sv/inicio/semana";
import { PautaItem } from "@/components/sv/pauta-item";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { Lacuna, Nota, Proxima, Quadro, Resposta, Selo } from "@/components/sv/ui";
import { data, type PautaEntry, type PautaOverview } from "@/lib/data";
import { weekLastDay } from "@/lib/pauta";

export const metadata: Metadata = { title: "O que mexe comigo?" };

const LEIS = 30;
const byDate = (a: PautaEntry, b: PautaEntry) => a.scheduledFor.localeCompare(b.scheduledFor) || a.key.localeCompare(b.key);
const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${fmtInt(n)} ${varios}`);
const FONTE_PAUTA = "pauta da Câmara dos Deputados e do Senado Federal";

export default async function Decisoes({ searchParams }: { searchParams: Promise<{ aba?: string | string[]; simular?: string | string[] }> }) {
  const sp = await searchParams;
  const tab = sp.aba === "leis" ? "leis" : "pauta";
  // `?simular=erro` só vale na demonstração (simular.ts): é como a leitura que falha é testada
  const falhar = simulacao(sp.simular) === "erro";

  return (
    <div className="sv-pg sv-pg--dcs">
      <div className="sv-folio sv-folio--dom">
        <h1>O que mexe comigo?</h1>
        <p className="sv-intro">O que está marcado para ser decidido e o que já virou lei. Proposta não é lei: cada item diz em que etapa está.</p>
      </div>
      <nav className="sv-abas" aria-label="Recorte">
        <Link href="/v2/decisoes" aria-current={tab === "pauta" ? "page" : undefined}>
          Em pauta
        </Link>
        <Link href="/v2/decisoes?aba=leis" aria-current={tab === "leis" ? "page" : undefined}>
          Viraram lei
        </Link>
      </nav>
      {tab === "pauta" ? <Pauta falhar={falhar} /> : <Leis falhar={falhar} />}
      <Proxima href="/v2/temas" pergunta="O que está em jogo no Congresso?" className="sv-c5" />
    </div>
  );
}

async function Pauta({ falhar }: { falhar: boolean }) {
  const o: PautaOverview | null = await lerOuFalhar(falhar, () => data.getPautaOverview()).catch(() => null);
  if (!o) {
    return (
      <>
        <Quadro id="dc-1" variante="lacuna" numero={1} pergunta="O que está marcado para ser decidido?" prova={`Fonte: ${FONTE_PAUTA}.`}>
          <Lacuna motivo="Não conseguimos ler a pauta agora. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
          <p className="sv-t">Isso não quer dizer que nada está marcado.</p>
        </Quadro>
        <Selo id="dc-selo" numero={2} className="sv-c7" />
      </>
    );
  }
  const readAt = o.week.readAt ?? ([o.reads.camara.readAt, o.reads.senado.readAt].filter(Boolean).sort().at(-1) as string | undefined) ?? null;
  const falhas = o.reads.camara.failed + o.reads.senado.failed;
  const reunioes = o.reads.camara.total + o.reads.senado.total;
  const prova = `Fonte: ${FONTE_PAUTA}${readAt ? `, lida em ${fmtDateTime(readAt)}` : ", ainda não lida"}.`;
  const plenario = [...o.plenary].sort(byDate);
  const comissoes = [...o.committees].sort(byDate);
  const ateQuando = fmtDate(weekLastDay(o.week.weekEnds)); // weekEnds é exclusivo: o último dia é o anterior
  let legendaFeita = false;
  const legenda = () => {
    const l = !legendaFeita;
    legendaFeita = true;
    return l;
  };

  let resposta: string;
  if (!readAt) resposta = "A pauta desta semana ainda não foi lida.";
  else if (plenario.length === 0) resposta = "Nada do que acompanhamos está marcado no plenário nesta semana.";
  else resposta = `${plural(plenario.length, "proposta que acompanhamos está marcada", "propostas que acompanhamos estão marcadas")} no plenário até ${ateQuando}.`;

  let n = 1;
  return (
    <>
      <Quadro id="dc-1" variante={readAt ? "dom" : "lacuna"} numero={n++} pergunta="O que está marcado para ser decidido?" prova={prova}>
        {readAt ? <Resposta tamanho="dom">{resposta}</Resposta> : <Lacuna>{resposta}</Lacuna>}
        {comissoes.length > 0 && <p className="sv-t">Em comissão, nas reuniões lidas: {plural(comissoes.length, "proposta", "propostas")}. Comissão é uma etapa: a decisão final costuma vir depois, no plenário.</p>}
        {falhas > 0 && (
          <p className="sv-t">
            <b>Leitura incompleta:</b> {fmtInt(falhas)} de {fmtInt(reunioes)} reuniões não carregaram. Pode haver mais decisões do que as mostradas.
          </p>
        )}
        {(!readAt || plenario.length === 0) && <p className="sv-t">Isso não quer dizer que nada vai acontecer. Só lemos o que a Câmara e o Senado publicaram.</p>}
        <NotaRegra />
      </Quadro>

      <Quadro
        id="dc-plen"
        variante={plenario.length ? "padrao" : "lacuna"}
        numero={n++}
        pergunta={`O que vai ao plenário até ${ateQuando}?`}
        className="sv-tira"
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: propostas inventadas para a demonstração</ExemploIlustrativo> Em ordem de data. {prova}
          </>
        }
      >
        {plenario.length === 0 ? (
          <Lacuna>{readAt ? "Nada do que acompanhamos está marcado no plenário nesta semana." : "A pauta desta semana ainda não foi lida."}</Lacuna>
        ) : (
          <ol className="sv-pis">
            {plenario.map((e) => (
              <PautaItem key={`${e.key}-${e.scheduledFor}`} e={e} legenda={legenda()} />
            ))}
          </ol>
        )}
      </Quadro>

      <Quadro id="dc-com" variante={comissoes.length ? "padrao" : "lacuna"} numero={n++} pergunta="O que está em comissão?" className="sv-tira" prova={`Em ordem de data, nas reuniões de comissão lidas. ${prova}`}>
        {comissoes.length === 0 ? (
          <Lacuna>{readAt ? "Nada do que acompanhamos está marcado em comissão nas reuniões lidas." : "A pauta desta semana ainda não foi lida."}</Lacuna>
        ) : (
          <ol className="sv-pis">
            {comissoes.map((e) => (
              <PautaItem key={`${e.key}-${e.scheduledFor}-${e.committee ?? ""}`} e={e} legenda={legenda()} />
            ))}
          </ol>
        )}
      </Quadro>

      {o.exits.length > 0 && (
        <Quadro id="dc-saiu" variante="fio" numero={n++} pergunta="O que saiu da pauta?" className="sv-tira" prova={`A fonte não informa o motivo da saída. ${prova}`}>
          <ol className="sv-pis">
            {o.exits.map((e) => (
              <PautaItem key={`${e.key}-${e.leftAt}`} e={e} legenda={legenda()} quando={`Saiu da pauta em ${fmtDate(e.leftAt)}.`} />
            ))}
          </ol>
        </Quadro>
      )}

      <Selo id="dc-selo" numero={n++} lidoEm={readAt} className="sv-c7" />
    </>
  );
}

async function Leis({ falhar }: { falhar: boolean }) {
  const laws = await lerOuFalhar(falhar, () => data.listLaws({ limit: LEIS })).catch(() => null);
  const prova = "Fonte: Câmara dos Deputados, dados abertos (normas), data da leitura não registrada.";
  const n = laws?.items.length ?? 0;
  return (
    <>
      <Quadro id="dc-1" variante={laws && laws.total > 0 ? "dom" : "lacuna"} numero={1} pergunta="O que já virou lei?" prova={prova}>
        {!laws ? (
          <Lacuna motivo="A lista de leis não pôde ser lida. Tente de novo em alguns minutos.">{FALHOU_LEITURA}</Lacuna>
        ) : laws.total === 0 ? (
          <Lacuna motivo="Nenhuma lei federal foi carregada ainda.">{SEM_DADO}</Lacuna>
        ) : (
          <>
            <Resposta tamanho="dom">{plural(laws.total, "lei federal carregada", "leis federais carregadas")}.</Resposta>
            {n < laws.total && (
              <p className="sv-t">
                Esta página mostra as {fmtInt(n)} mais recentes de {fmtInt(laws.total)}.
              </p>
            )}
          </>
        )}
        <p className="sv-t">Lei publicada pode ter prazo para começar a valer. O texto oficial diz quando.</p>
      </Quadro>

      {laws && n > 0 && (
        <Quadro id="dc-leis" numero={2} pergunta="Quais leis, da mais recente para a mais antiga?" className="sv-tira" prova={prova}>
          <ol className="sv-pis">
            {laws.items.map((l) => (
              <li key={l.number} className="sv-pi">
                <p className="sv-vl__d">Sancionada em {fmtDate(l.sanctionedOn)}</p>
                <Resposta tamanho="m">{l.url ? <a href={l.url} rel="noopener noreferrer">{clip(l.summary, 200)}</a> : clip(l.summary, 200)}</Resposta>
                <Nota>
                  Lei {l.number}
                  {l.proposal ? `, veio de ${l.proposal}` : ""}.
                </Nota>
              </li>
            ))}
          </ol>
          {n < laws.total && (
            <p className="sv-t">
              Mostrando {fmtInt(n)} de {fmtInt(laws.total)}.
            </p>
          )}
        </Quadro>
      )}

      <Selo id="dc-selo" numero={laws && n > 0 ? 3 : 2} className="sv-c7" />
    </>
  );
}

