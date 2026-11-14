import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/styles/sv-votacao.css";
import { lidoEm } from "@/components/sv/carimbo";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { BODY_NAME, clip, fmtDate, fmtDateTime, fmtInt } from "@/components/sv/fmt";
import { FalhaDeLeitura } from "@/components/sv/falha-leitura";
import { placarDe } from "@/components/sv/placar";
import { lerOuFalhar, simulacao } from "@/components/sv/simular";
import { Lacuna, Nota, Placar, Proxima, Quadro, Resposta, Selo, VotoMarca } from "@/components/sv/ui";
import { data, type VoteValue, type VotingEventDetail } from "@/lib/data";

const ID = /^[A-Za-z0-9-]{1,80}$/;
const load = (id: string) => (ID.test(id) ? data.getVotingEvent(id) : Promise.resolve(null));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ev = await load((await params).id).catch(() => null);
  return { title: ev ? `Como foi esta votação? ${ev.proposal?.label ?? ""}`.trim() : "Votação não encontrada" };
}

// Ordem fixa das listas: nunca por tamanho.
const ORDER: VoteValue[] = ["sim", "nao", "abstencao", "obstrucao", "art17", "nao_votou"];
const HEAD: Record<VoteValue, string> = { sim: "Votaram sim", nao: "Votaram não", abstencao: "Abstiveram-se", obstrucao: "Em obstrução", art17: "Presidia a sessão", nao_votou: "Sem voto registrado" };
const NA_CASA = { camara: "na Câmara", senado: "no Senado" } as const;
const SEM_INDIVIDUAL = "A fonte não publicou o voto de cada pessoa nesta votação.";

/** Placar da UF: contagem por voto, como a fonte publicou, ao lado das cadeiras da UF fixadas em lei. Nunca "ausentes". */
function PlacarDaUf({ ev, uf }: { ev: VotingEventDetail; uf: string }) {
  const p = ev.porUf;
  if (p.kind !== "placar") return null;
  const row = p.ufs.find((x) => x.uf === uf);
  if (!row) return null;
  const partes = ORDER.filter((v) => row.contagem[v] > 0).map((v) => `${HEAD[v]}: ${row.contagem[v]}`);
  return (
    <div className="sv-vt-uf" data-placar-uf={uf}>
      {/* a primeira frase é o placar: "UF: N registros…, de C cadeiras…" e "Rótulo: n." somando N */}
      <p className="sv-a sv-a--m">
        {uf}: {row.registros} {row.registros === 1 ? "registro" : "registros"} nesta votação, de {row.cadeiras} cadeiras de {uf} {NA_CASA[ev.body]}.
        {partes.length > 0 ? ` ${partes.join(". ")}.` : ""}
      </p>
      <p className="sv-t">
        Cadeiras: {p.fonteCadeiras}. Menos registros que cadeiras não quer dizer ausência: a fonte publica só quem teve registro.
        {p.semUf > 0 ? ` ${p.semUf} ${p.semUf === 1 ? "registro sem estado identificado" : "registros sem estado identificado"} (${p.motivoSemUf}).` : ""}
      </p>
    </div>
  );
}

/** Quem votou, por voto (ordem fixa) e, dentro de cada voto, em ordem alfabética. Um <ul> por voto. */
function Nomes({ ev, uf }: { ev: VotingEventDetail; uf: string }) {
  const people = ev.votes.filter((v) => v.uf === uf).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (people.length === 0) return <Lacuna>Não consta voto registrado de parlamentares de {uf} nesta votação.</Lacuna>;
  return (
    <div className="sv-vt-grupos">
      {ORDER.map((val) => {
        const group = people.filter((p) => p.value === val);
        if (group.length === 0) return null;
        return (
          <div key={val} className="sv-vt-grupo">
            <h3>
              {/* a palavra do voto já está no texto do título ("Votaram sim: n"): a marca é só visual */}
              <span aria-hidden="true">
                <VotoMarca voto={val} />
              </span>
              <span>
                {HEAD[val]}: {group.length}
              </span>
            </h3>
            <ul className="sv-vt-pes">
              {group.map((p) => (
                <li key={p.slug}>
                  <Link href={`/pessoa/${p.slug}`}>{p.name}</Link>
                  <span className="sv-vt-pt">{p.party}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default async function Votacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ uf?: string | string[]; simular?: string | string[] }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  // null = não existe (404); undefined = a leitura falhou (lacuna, nunca 500). `?simular=erro` só vale na demonstração.
  const ev = await lerOuFalhar(simulacao(sp.simular) === "erro", () => load(id)).catch(() => undefined);
  if (ev === null) notFound();
  if (ev === undefined) return <FalhaDeLeitura titulo="Como foi esta votação?" pergunta="O que foi votado?" oQue="esta votação" proxima={{ href: "/votacoes", pergunta: "Que outras votações houve?" }} />;
  const stamp = await data.getStamp(`${ev.body}.votacoes`).catch(() => null);

  const placar = placarDe(ev);
  // sem voto individual carregado (secreta, aberta sem voto publicado ou nenhum registro): o placar por UF já é lacuna.
  // Lacuna `semMandatos` é outra coisa: há voto individual, só não há UF na data para a maioria (o placar geral fica).
  const semIndividual = (ev.porUf.kind === "lacuna" && !ev.porUf.semMandatos) || placar.kind === "lacuna";
  const ufs = [...new Set(ev.votes.map((v) => v.uf).filter((u): u is string => !!u))].sort();
  const ufRaw = typeof sp.uf === "string" ? sp.uf.toUpperCase() : null; // `?uf=SP&uf=RJ` chega como array: ignorado
  const uf = ufRaw && ufs.includes(ufRaw) ? ufRaw : null;
  const title = ev.proposal?.summary ?? ev.description;
  const fonte = `Fonte: ${BODY_NAME[ev.body]}, votação nominal de ${fmtDateTime(ev.occurredAt)}.`;
  const motivoLacuna = ev.porUf.kind === "lacuna" ? ev.porUf.motivo : placar.kind === "lacuna" && placar.motivo ? placar.motivo : SEM_INDIVIDUAL;

  return (
    <div className="sv-pg sv-pg--vt">
      <div className="sv-folio sv-folio--dom">
        <h1>Como foi esta votação?</h1>
        <p className="sv-intro">
          Votação nominal {NA_CASA[ev.body]}, {fmtDate(ev.occurredAt)}.
        </p>
      </div>

      <Quadro
        id="vt-1"
        variante="dom"
        numero={1}
        pergunta="O que foi votado?"
        className="sv-c7"
        prova={
          <>
            {fonte}
            {ev.proposal?.url ? (
              <>
                {" "}
                <a className="sv-lk" href={ev.proposal.url} rel="noopener noreferrer">
                  Ver a proposta no site oficial
                </a>
              </>
            ) : null}
          </>
        }
      >
        <p className="sv-esf">Esfera: Federal · {BODY_NAME[ev.body]}</p>
        <Resposta tamanho="fala">{clip(title, 200)}</Resposta>
        <p className="sv-t">
          {ev.proposal?.label ? `${ev.proposal.label}. ` : ""}
          {ev.result ? `Resultado: ${ev.result}.` : "Resultado não publicado pela fonte."}
        </p>
        {ev.proposal?.summary && ev.description !== ev.proposal.summary && <p className="sv-t">O que foi votado nesta sessão: {clip(ev.description, 260)}</p>}
        <Nota>Aprovar ou rejeitar um texto não diz se a decisão foi boa. A página mostra o que a fonte registrou.</Nota>
      </Quadro>

      <Quadro id="vt-2" variante={semIndividual ? "lacuna" : "padrao"} numero={2} pergunta="Qual foi o placar?" className="sv-c5" prova={fonte}>
        {semIndividual ? (
          // sem voto individual: lacuna nomeada, nunca tabela de zeros; o placar total só se a fonte o publicou
          <div className="sv-vt-lac" data-sem-voto-individual>
            <Lacuna>{motivoLacuna}</Lacuna>
            {/* nulo = a fonte não publicou; zero publicado é dado e aparece */}
            {ev.placarFonte.sim !== null && ev.placarFonte.nao !== null && (
              <p className="sv-t">
                Placar total publicado pela fonte: {ev.placarFonte.sim} sim e {ev.placarFonte.nao} não.
              </p>
            )}
          </div>
        ) : (
          <>
            <Resposta tamanho="m">{fmtInt(placar.total)} registros nesta votação.</Resposta>
            <Placar titulo={`Placar da votação de ${fmtDate(ev.occurredAt)}, ${BODY_NAME[ev.body]}`} sim={placar.sim} nao={placar.nao} abs={placar.abs} sem={placar.sem} />
            {placar.obstrucao > 0 && <Nota>Obstrução: {placar.obstrucao}. É um registro próprio da Casa e não entra nas quatro linhas acima.</Nota>}
            <Nota>
              Sem voto soma quem não registrou voto ({ev.counts.nao_votou ?? 0}) e quem presidia a sessão ({ev.counts.art17 ?? 0}). Não é voto contra. A fonte publica só quem teve registro: ausência não aparece.
            </Nota>
          </>
        )}
      </Quadro>

      <Quadro
        id="vt-3"
        variante={ev.porUf.kind === "lacuna" || ufs.length === 0 ? "lacuna" : "padrao"}
        numero={3}
        pergunta={uf ? `Como votaram os parlamentares de ${uf}?` : "Como votou cada estado?"}
        prova={
          <>
            <ExemploIlustrativo>Exemplo ilustrativo: pessoas e votos inventados para a demonstração</ExemploIlustrativo> Pessoas em ordem alfabética dentro de cada voto. A UF é a do mandato nesta Casa na data da votação. {fonte}
          </>
        }
      >
        {ev.porUf.kind === "lacuna" ? (
          <Lacuna>{ev.porUf.motivo}</Lacuna>
        ) : ufs.length === 0 ? (
          <Lacuna>{SEM_INDIVIDUAL}</Lacuna>
        ) : (
          <>
            {!uf && <Resposta tamanho="m">Escolha um estado para ver o voto de cada pessoa, em ordem alfabética.</Resposta>}
            <nav className="sv-ufs" aria-label="Estado">
              {ufs.map((u) => (
                <Link key={u} href={`/votacao/${ev.id}?uf=${u}`} aria-current={u === uf ? "page" : undefined}>
                  {u}
                </Link>
              ))}
            </nav>
            {uf && <PlacarDaUf ev={ev} uf={uf} />}
            {uf && <Nomes ev={ev} uf={uf} />}
          </>
        )}
        {ev.porUf.kind === "placar" && ev.porUf.semUf > 0 && (
          // quem ficou fora do placar por UF, nominalmente e em ordem alfabética: a lacuna tem nome
          <div className="sv-vt-semuf" data-sem-uf>
            <h3 className="sv-sub">Sem estado identificado: {ev.porUf.semUf}</h3>
            <p className="sv-t">
              Fora do placar por estado: {ev.porUf.motivoSemUf}. {ev.porUf.semUfNomes.join(", ")}.
            </p>
          </div>
        )}
      </Quadro>

      <Selo id="vt-selo" numero={4} lidoEm={lidoEm(stamp)} className="sv-c7" />
      <Proxima href="/votacoes" pergunta="Que outras votações houve?" className="sv-c5" />
    </div>
  );
}
