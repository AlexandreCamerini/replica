import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BODY_NAME, clip, fmtDate, fmtDateTime } from "@/components/sv/fmt";
import { Bar, Gap, Label, List, Src, VoteMark } from "@/components/sv/ui";
import { data, type VoteValue, type VotingEventDetail } from "@/lib/data";

const ID = /^[A-Za-z0-9-]{1,80}$/;
const load = (id: string) => (ID.test(id) ? data.getVotingEvent(id) : Promise.resolve(null));

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const ev = await load((await params).id);
  return { title: ev ? (ev.proposal?.label ?? "Votação") : "Votação não encontrada" };
}

// Ordem fixa das listas: nunca por tamanho.
const ORDER: VoteValue[] = ["sim", "nao", "abstencao", "obstrucao", "art17", "nao_votou"];
const HEAD: Record<VoteValue, string> = { sim: "Votaram sim", nao: "Votaram não", abstencao: "Abstiveram-se", obstrucao: "Em obstrução", art17: "Presidia a sessão", nao_votou: "Sem voto registrado" };

function Names({ ev, uf }: { ev: VotingEventDetail; uf: string }) {
  const people = ev.votes.filter((v) => v.uf === uf).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (people.length === 0) return <Gap>Não consta voto registrado de parlamentares de {uf} nesta votação.</Gap>;
  return (
    <>
      {ORDER.map((val) => {
        const group = people.filter((p) => p.value === val);
        if (group.length === 0) return null;
        return (
          <div key={val} className="sv-mt-3">
            <Label>
              {HEAD[val]}: {group.length}
            </Label>
            <List>
              {group.map((p) => (
                <Link key={p.slug} className="sv-voterow" href={`/v2/pessoa/${p.slug}`} style={{ textDecoration: "none" }}>
                  <div>
                    {p.name}
                    <small>{p.party}</small>
                  </div>
                  <VoteMark value={p.value} />
                </Link>
              ))}
            </List>
          </div>
        );
      })}
    </>
  );
}

/** Placar da UF: contagem por voto, como a fonte publicou, ao lado das cadeiras da UF fixadas em lei. Nunca "ausentes". */
function PlacarDaUf({ ev, uf }: { ev: VotingEventDetail; uf: string }) {
  const p = ev.porUf;
  if (p.kind !== "placar") return null;
  const row = p.ufs.find((x) => x.uf === uf);
  if (!row) return null;
  const partes = ORDER.filter((v) => row.contagem[v] > 0).map((v) => `${HEAD[v]}: ${row.contagem[v]}`);
  return (
    <div className="sv-mt-3" data-placar-uf={uf}>
      <p className="sv-meta">
        {uf}: {row.registros} {row.registros === 1 ? "registro" : "registros"} nesta votação, de {row.cadeiras} cadeiras de {uf} {ev.body === "camara" ? "na Câmara" : "no Senado"}.
        {partes.length > 0 ? ` ${partes.join(". ")}.` : ""}
      </p>
      <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
        Cadeiras: {p.fonteCadeiras}. Menos registros que cadeiras não quer dizer ausência: a fonte publica só quem teve registro.
        {p.semUf > 0 ? ` ${p.semUf} ${p.semUf === 1 ? "registro sem estado identificado" : "registros sem estado identificado"} (sem mandato desta casa carregado na data).` : ""}
      </p>
    </div>
  );
}

export default async function Votacao({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ uf?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ev = await load(id);
  if (!ev) notFound();

  const c = ev.counts;
  const total = ORDER.reduce((s, k) => s + (c[k] ?? 0), 0);
  const others = (c.obstrucao ?? 0) + (c.art17 ?? 0) + (c.nao_votou ?? 0);
  // sem voto individual carregado (secreta, aberta sem voto publicado ou nenhum registro): o placar por UF já é lacuna
  const semIndividual = ev.porUf.kind === "lacuna" || total === 0;
  const ufs = [...new Set(ev.votes.map((v) => v.uf).filter((u): u is string => !!u))].sort();
  const ufRaw = typeof sp.uf === "string" ? sp.uf.toUpperCase() : null; // `?uf=SP&uf=RJ` chega como array: ignorado
  const uf = ufRaw && ufs.includes(ufRaw) ? ufRaw : null;
  const title = ev.proposal?.summary ?? ev.description;

  return (
    <>
      <div className="sv-grid is-7-5">
        <div>
          <Label>
            Votação {ev.body === "camara" ? "na Câmara" : "no Senado"}, {fmtDate(ev.occurredAt)}
          </Label>
          <h1 className="sv-title sv-mt-1" style={{ fontSize: "clamp(28px,3.6vw,46px)" }}>
            {clip(title, 160)}
          </h1>
          <p className="sv-meta sv-mt-2">
            {ev.proposal?.label ? `${ev.proposal.label}. ` : ""}
            {semIndividual ? "" : `${total} registros nesta votação.`}
            {ev.result ? ` Resultado: ${ev.result}.` : ""}
          </p>
          {ev.proposal?.summary && ev.description !== ev.proposal.summary && <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>O que foi votado: {clip(ev.description, 260)}</p>}

          {semIndividual ? (
            // sem voto individual: lacuna nomeada, nunca barras de zeros; o placar total só se a fonte o publicou
            <div className="sv-mt-3" data-sem-voto-individual>
              <Gap>{ev.porUf.kind === "lacuna" ? ev.porUf.motivo : "A fonte não publicou o voto de cada pessoa nesta votação."}</Gap>
              {(ev.yes ?? 0) + (ev.no ?? 0) > 0 && (
                <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
                  Placar total publicado pela fonte: {ev.yes} sim e {ev.no} não.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="sv-mt-3" role="img" aria-label={`Sim ${c.sim ?? 0}, Não ${c.nao ?? 0}, Abstenção ${c.abstencao ?? 0}, outros registros ${others}`}>
                <Bar label="Sim" kind="is-sim" weight={600} n={c.sim ?? 0} total={total} />
                <Bar label="Não" kind="is-nao" weight={600} n={c.nao ?? 0} total={total} />
                <Bar label="Abstenção" kind="is-abs" weight={600} n={c.abstencao ?? 0} total={total} />
                <Bar label="Outros" weight={200} n={others} total={total} />
              </div>
              <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
                Outros soma obstrução ({c.obstrucao ?? 0}), quem presidia ({c.art17 ?? 0}) e quem não registrou voto ({c.nao_votou ?? 0}). Não é voto contra. A fonte publica só quem teve registro: ausência não aparece.
              </p>
            </>
          )}
        </div>

        <div>
          <Label>{uf ? `Parlamentares de ${uf}` : "Ver por estado"}</Label>
          {ev.porUf.kind === "lacuna" ? (
            <Gap>{ev.porUf.motivo}</Gap>
          ) : ufs.length === 0 ? (
            <Gap>A fonte não publicou o voto de cada pessoa nesta votação.</Gap>
          ) : (
            <p style={{ display: "flex", flexWrap: "wrap", gap: "2px 4px", marginTop: 6 }}>
              {ufs.map((u) => (
                <Link key={u} href={`/v2/votacao/${ev.id}?uf=${u}`} aria-current={u === uf ? "true" : undefined} style={{ fontWeight: u === uf ? 900 : 500, padding: "10px 7px", minWidth: 44, textAlign: "center", textUnderlineOffset: 3, textDecoration: u === uf ? "none" : "underline", background: u === uf ? "var(--block)" : undefined, color: u === uf ? "var(--on-block)" : undefined }}>
                  {u}
                </Link>
              ))}
            </p>
          )}
          {uf && <PlacarDaUf ev={ev} uf={uf} />}
          {uf && <Names ev={ev} uf={uf} />}
        </div>
      </div>

      <Src>
        Fonte: {BODY_NAME[ev.body]}, votação nominal de {fmtDateTime(ev.occurredAt)}.
        {ev.proposal?.url ? (
          <>
            {" "}
            <a href={ev.proposal.url} rel="noopener noreferrer">
              Ver a proposta no site oficial
            </a>
          </>
        ) : null}
      </Src>
    </>
  );
}
