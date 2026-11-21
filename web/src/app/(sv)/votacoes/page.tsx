import type { Metadata } from "next";
import Link from "next/link";
import "@/styles/sv-votacoes.css";
import { fraseLida, lidoEm } from "@/components/sv/carimbo";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { FALHOU_LEITURA, SEM_DADO } from "@/components/sv/estados";
import { BODY_NAME, clip, fmtDate, fmtInt } from "@/components/sv/fmt";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { Lacuna, Nota, Proxima, Quadro, Resposta, Selo } from "@/components/sv/ui";
import { VotacaoItem } from "@/components/sv/votacao-item";
import { MapaVotos } from "@/components/sv/mapa-votos";
import { data, type Body, type VotingEventDetail } from "@/lib/data";

export const metadata: Metadata = { title: "Como votaram no Congresso?" };

const PASSO = 30;
const TETO = 100; // a fonte devolve no máximo 100 (pg.ts e fake.ts): o que fica de fora é dito, não escondido
// Quantas das votações mais recentes da lista se olham em busca do placar por UF (cada uma é uma leitura de detalhe).
const TENTATIVAS_MAPA = 5;
/** A votação mais recente da lista (já em ordem da mais recente para a mais antiga) que tem placar por UF; null se nenhuma tem. */
async function maisRecenteComPlacar(ids: readonly string[]): Promise<{ ev: VotingEventDetail | null; olhadas: number; falhas: number }> {
  const alvo = ids.slice(0, TENTATIVAS_MAPA);
  let falhas = 0;
  for (const id of alvo) {
    let ev: VotingEventDetail | null = null;
    try {
      ev = await data.getVotingEvent(id);
    } catch {
      falhas++;
      continue;
    }
    if (ev?.porUf.kind === "placar") return { ev, olhadas: alvo.length, falhas };
  }
  return { ev: null, olhadas: alvo.length, falhas };
}

const DA_CASA = { camara: "da Câmara", senado: "do Senado" } as const;

export default async function Votacoes({ searchParams }: { searchParams: Promise<{ casa?: string | string[]; tudo?: string | string[]; n?: string | string[]; simular?: string | string[] }> }) {
  const sp = await searchParams;
  const so = (v: unknown) => (typeof v === "string" ? v : undefined); // parâmetro repetido chega como array: ignorado
  const body: Body = so(sp.casa) === "senado" ? "senado" : "camara";
  const tudo = so(sp.tudo) === "1";
  const pedido = Math.min(TETO, Math.max(PASSO, Number.parseInt(so(sp.n) ?? `${PASSO}`, 10) || PASSO));

  const [page, stamp] = await Promise.all([
    // `?simular=erro` só vale na demonstração (simular.ts): é como a leitura que falha é testada
    lerOuFalhar(simulacao(sp.simular) === "erro", () => data.listVotingEvents({ body, limit: pedido, scope: tudo ? "tudo" : "lei" })).catch(() => null),
    data.getStamp(`${body}.votacoes`).catch(() => null),
  ]);
  const lida = lidoEm(stamp);
  const busca = page && page.items.length > 0 ? await maisRecenteComPlacar(page.items.map((v) => v.id)) : null;
  const comMapa = busca?.ev ?? null;
  const leituraFalhou = !page || (!!busca && !comMapa && busca.falhas === busca.olhadas);
  const fonte = `Fonte: ${BODY_NAME[body]}, votações nominais, dados abertos${fraseLida(stamp, "as")}.`;

  const qs = (o: { casa?: Body; tudo?: boolean; n?: number }) => {
    const u = new URLSearchParams();
    if ((o.casa ?? body) === "senado") u.set("casa", "senado");
    if (o.tudo ?? tudo) u.set("tudo", "1");
    if (o.n && o.n > PASSO) u.set("n", String(o.n));
    const s = u.toString();
    return s ? `/votacoes?${s}` : "/votacoes";
  };

  const n = page?.items.length ?? 0;
  const truncada = !!page && n < page.total;
  // pelo número DEVOLVIDO: se a fonte devolveu menos que o pedido (ou chegou ao teto), pedir mais não acrescenta nada
  const noTeto = truncada && (n >= TETO || n < pedido);
  const oQue = tudo ? "votações nominais" : "votações que mudam o texto de uma proposta";

  let resposta: string;
  if (!page) resposta = FALHOU_LEITURA;
  else if (page.total === 0) resposta = `Nenhuma votação ${DA_CASA[body]} carregada ainda.`;
  else resposta = `${fmtInt(page.total)} ${page.total === 1 ? (tudo ? "votação nominal" : "votação que muda o texto de uma proposta") : oQue} ${DA_CASA[body]}.`;

  return (
    <div className="sv-pg sv-pg--vts">
      <div className="sv-folio sv-folio--dom">
        <h1>Como votaram no Congresso?</h1>
        <p className="sv-intro">Cada votação nominal, com o voto de cada pessoa, da mais recente para a mais antiga.</p>
      </div>

      <nav className="sv-abas" aria-label="Casa">
        <Link href={qs({ casa: "camara" })} aria-current={body === "camara" ? "page" : undefined}>
          Câmara dos Deputados
        </Link>
        <Link href={qs({ casa: "senado" })} aria-current={body === "senado" ? "page" : undefined}>
          Senado Federal
        </Link>
      </nav>

      <Quadro
        id="vts-mapa"
        variante={comMapa ? "padrao" : "lacuna"}
        numero={1}
        pergunta="Como votou cada estado na votação mais recente com voto por estado?"
        className="sv-c12"
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: votação inventada para a demonstração</ExemploIlustrativo> {comMapa ? `Votação nominal ${DA_CASA[body]} de ${fmtDate(comMapa.occurredAt)}, a mais recente da lista com placar por estado. ` : ""}
            {fonte}
          </>
        }
      >
        {comMapa && comMapa.porUf.kind === "placar" ? (
          <>
            <p className="sv-t" data-mapa-votacao>
              <Link className="sv-lk" href={`/votacao/${comMapa.id}`}>
                {clip(comMapa.proposal?.summary ?? comMapa.description, 160)}
              </Link>
            </p>
            <MapaVotos placar={comMapa.porUf.ufs} ufSelecionada={null} votacaoId={comMapa.id} listaAbaixo={false} />
          </>
        ) : (
          <Lacuna motivo={leituraFalhou ? undefined : busca ? `Olhamos as ${busca.olhadas} votações mais recentes ${DA_CASA[body]} desta lista e nenhuma tem o voto de cada pessoa com estado identificado.` : undefined}>
            {leituraFalhou ? FALHOU_LEITURA : "O mapa por estado não está disponível para as votações mais recentes."}
          </Lacuna>
        )}
      </Quadro>

      <Quadro id="vts-1" variante={page ? "dom" : "lacuna"} numero={2} pergunta={`Quantas votações ${DA_CASA[body]} lemos?`} prova={fonte}>
        {page ? <Resposta tamanho="dom">{resposta}</Resposta> : <Lacuna motivo="A lista de votações não pôde ser lida. Tente de novo em alguns minutos.">{resposta}</Lacuna>}
        {page && page.total > 0 && truncada && (
          <p className="sv-t">
            Esta página mostra as {fmtInt(n)} mais recentes de {fmtInt(page.total)}.
          </p>
        )}
        <p className="sv-t">Votação simbólica não registra o voto de cada pessoa e não aparece aqui.</p>
        {page &&
          (tudo ? (
            <p className="sv-t">
              Aqui entram também requerimentos e pedidos de urgência.{" "}
              <Link className="sv-lk" href={qs({ tudo: false })}>
                Mostrar só o que muda o texto
              </Link>
            </p>
          ) : (
            <p className="sv-t">
              {page.hidden > 0 ? `Outras ${fmtInt(page.hidden)} votações de requerimento ou urgência ficam fora desta lista. ` : "Requerimentos e pedidos de urgência ficam fora desta lista. "}
              <Link className="sv-lk" href={qs({ tudo: true })}>
                Mostrar também essas votações
              </Link>
            </p>
          ))}
      </Quadro>

      <Quadro
        id="vts-2"
        variante={page && n > 0 ? "padrao" : "lacuna"}
        numero={3}
        pergunta="O que foi votado, da mais recente para a mais antiga?"
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: votações inventadas para a demonstração</ExemploIlustrativo> {fonte}
          </>
        }
      >
        {!page ? (
          <Lacuna>{FALHOU_LEITURA}</Lacuna>
        ) : n === 0 ? (
          <Lacuna motivo={`Nenhuma votação ${DA_CASA[body]} foi carregada neste recorte.`}>{SEM_DADO}</Lacuna>
        ) : (
          <>
            <ol className="sv-vls">
              {page.items.map((v) => (
                <VotacaoItem key={v.id} v={v} />
              ))}
            </ol>
            <Nota>
              O placar da lista é o total que a fonte publicou, Sim e Não. Abstenção e Sem voto estão na página de cada votação. Sem voto não é voto contra.
            </Nota>
            {truncada && (
              <p className="sv-t">
                Mostrando {fmtInt(n)} de {fmtInt(page.total)}.{" "}
                {noTeto ? (
                  <>Esta lista vai até {fmtInt(n)}: as mais antigas ficam fora desta página.</>
                ) : (
                  <Link className="sv-lk" href={qs({ n: Math.min(TETO, n + PASSO) })}>
                    Mostrar mais {Math.min(PASSO, page.total - n, TETO - n)}
                  </Link>
                )}
              </p>
            )}
          </>
        )}
      </Quadro>

      <Selo id="vts-selo" numero={4} lidoEm={lida} className="sv-c7" />
      <Proxima href="/temas" pergunta="O que está em jogo no Congresso?" className="sv-c5" />
    </div>
  );
}
