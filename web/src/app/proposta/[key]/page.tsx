import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/page/page-header";
import { ShareButton, WhatsAppLink } from "@/components/people/share";
import { Claim, ReviewedBadge } from "@/components/pauta/answers";
import { conferidoEm } from "@/components/sv/estados";
import { AboutData, ReviewBadge, where } from "@/components/pauta/ui";
import { FreshnessLine } from "@/components/ui/freshness";
import { GlossaryFor } from "@/components/ui/glossary";
import { data, type PautaProposal } from "@/lib/data";
import { count, date } from "@/lib/format";
import { bodyFullName, ofBody, dateTime, dayLong, dayShort, deciders, isUrgent, label, reasonText, time, typeName } from "@/lib/pauta";

type Props = { params: Promise<{ key: string }> };
export const revalidate = 600;

const load = (key: string) => data.getPautaProposal(key);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).key);
  if (!p) return { title: "Proposta não encontrada" };
  const e = p.entry;
  const title = `${label(e)}, ${typeName(e.type)}, na pauta ${ofBody(e.body)}`;
  // prévia do WhatsApp: título, descrição de até 2 linhas, sem adjetivo
  const description = e.summary ? (e.summary.length > 150 ? `${e.summary.slice(0, 147).trimEnd()}…` : e.summary) : undefined;
  return { title, description, openGraph: { title, description, type: "article" } };
}

function StatusNote({ p }: { p: PautaProposal }) {
  const s = p.status;
  if (s.kind === "na_pauta") return null;
  const text =
    s.kind === "saiu" ? `Saiu da pauta lida em ${dateTime(s.at)}. A fonte não informa o motivo.`
    : s.kind === "reuniao_encerrada" ? `A reunião de ${dayShort(p.entry.scheduledFor)} já aconteceu. O resultado aparece aqui quando a Casa publicar a votação.`
    : s.kind === "reuniao_cancelada" ? `A reunião de ${dayShort(p.entry.scheduledFor)} foi cancelada. A proposta não está em outra pauta lida até agora.`
    : `Não está na última pauta lida. Foi vista na pauta pela última vez em ${dateTime(s.lastSeenAt)}.`;
  return <p className="flex flex-wrap items-center gap-3 border border-fg bg-surface px-4 py-3 text-base text-fg"><span className="stamp">{s.kind === "saiu" ? "Saiu da pauta" : s.kind === "reuniao_cancelada" ? "Reunião cancelada" : s.kind === "reuniao_encerrada" ? "Reunião já aconteceu" : "Fora da última leitura"}</span>{text}</p>;
}

function Q({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id ?? title}-h`} className="scroll-mt-28 border-t border-fg py-5">
      <h2 id={`${id ?? title}-h`} className="mb-2 font-serif text-[24px] leading-tight font-medium text-fg">
        {title}
      </h2>
      <div className="flex flex-col gap-2 text-base text-fg">{children}</div>
    </section>
  );
}

export default async function Proposta({ params }: Props) {
  const { key } = await params;
  const p = await load(key);
  if (!p) notFound();
  const e = p.entry;
  const next = p.schedule[0] ?? null;
  const d = deciders(next ?? e);
  const path = `/proposta/${e.key}`;
  // U01: a pauta é a lista oficial que conferimos; o registro mais recente é a última votação nominal, ou a apresentação se ainda não votou
  const lastVote = p.votes.map((v) => v.occurredAt).sort().at(-1);
  const record = lastVote ? ({ kind: "votacao", on: lastVote.slice(0, 10) } as const) : p.presentedOn ? ({ kind: "proposta", on: p.presentedOn } as const) : null;
  return (
    <Container className="max-w-[880px]">
      <header className="flex flex-col gap-3">
        <FreshnessLine checkedAt={p.readAt} record={record} />
        <p className="lbl">
          {bodyFullName(e.body)} · {e.type} · {typeName(e.type)}
        </p>
        <h1 className="font-mono text-[28px] font-semibold text-fg md:text-[32px]">{label(e)}</h1>
        {e.plain && <p className="font-serif text-[28px] leading-[1.15] font-medium text-fg text-balance md:text-[36px]">{e.plain}</p>}
        <p className={e.plain ? "text-sm text-muted" : "text-base text-fg"}>
          <span className="text-muted">Resumo oficial: </span>
          {e.summary ?? "A pauta da comissão não traz o resumo oficial. Ele está no texto oficial."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {p.answers ? (
            <>
              <ReviewedBadge at={p.answers.reviewedAt} by={p.answers.verifiedBy} />
              {p.answers.correction && <span className="text-sm text-muted">Corrigida em {date(p.answers.correction.correctedAt)}.</span>}
            </>
          ) : (
            <>
              <ReviewBadge />
              <span className="text-sm text-muted">Por enquanto, só o resumo e o texto oficial.</span>
            </>
          )}
        </div>
        <StatusNote p={p} />
        <GlossaryFor texts={[label(e), typeName(e.type), e.type, e.summary, e.plain, (next?.rapporteur ?? e.rapporteur) ? "relator" : null]} />
        <div className="flex flex-wrap gap-2">
          {p.fichaUrl && (
            <a
              href={p.fichaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center border border-fg bg-surface-inverse px-4 text-sm font-semibold text-on-inverse outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Texto oficial
            </a>
          )}
          <ShareButton title={label(e)} path={path} />
          <WhatsAppLink text={`${label(e)}, ${typeName(e.type)}, na pauta ${ofBody(e.body)}.`} path={path} />
          <a href="#quem-decide" className="inline-flex h-11 items-center px-2 text-sm font-semibold text-fg underline underline-offset-2">
            Falar com quem decide
          </a>
        </div>
      </header>

      <div className="mt-6">
        <Q title="Por que esta proposta está aqui">
          <p>{reasonText(e)}</p>
          <Link href="/como-escolhemos" className="text-sm text-fg underline underline-offset-2">
            Ver a regra
          </Link>
        </Q>

        <Q title="Quem fez?">
          {p.authors.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {p.authors.map((a) => (
                <li key={a.slug}>
                  <Link href={`/p/${a.slug}`} className="underline underline-offset-2">
                    {a.name}
                  </Link>
                  <span className="text-muted"> · {a.role === "principal" ? "autoria" : "coautoria"}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">A autoria ainda não foi carregada aqui. Ela está no texto oficial.</p>
          )}
          {p.presentedOn && <p className="text-sm text-muted">Apresentada em {date(p.presentedOn)}.</p>}
        </Q>

        {p.answers ? (
          <>
            <Q title="O que propõe?">
              <Claim claim={p.answers.fields.o_que_propoe} sourceUrl={p.answers.sourceUrl} />
            </Q>
            <Q title="Quem ganha, quem paga e o que muda para mim?">
              <div className="flex flex-col gap-4">
                <Claim title="Quem recebe algo" claim={p.answers.fields.quem_recebe} sourceUrl={p.answers.sourceUrl} />
                <Claim title="Quem paga" claim={p.answers.fields.quem_paga} sourceUrl={p.answers.sourceUrl} />
                <Claim title="O que muda para quem mora no Brasil" claim={p.answers.fields.o_que_muda} sourceUrl={p.answers.sourceUrl} />
              </div>
            </Q>
            <Q title="O dinheiro entra, sai ou é dividido?">
              <div className="flex flex-col gap-4">
                <Claim claim={p.answers.fields.dinheiro} sourceUrl={p.answers.sourceUrl} />
                <Claim title="Estimativa de impacto oficial" claim={p.answers.fields.estimativa_impacto} sourceUrl={p.answers.sourceUrl} />
              </div>
              <Link href="/como-escolhemos#revisao" className="text-sm text-fg underline underline-offset-2">
                Como escrevemos e revisamos
              </Link>
            </Q>
          </>
        ) : (
          <Q title="O que propõe? Quem ganha, quem paga e o que muda para mim?">
            <p>Ainda estamos lendo o texto. Por enquanto, veja o resumo e o texto oficial.</p>
            <p className="text-sm text-muted">Uma pessoa confere cada resposta, com o trecho do texto oficial ao lado, antes de publicar.</p>
            <Link href="/como-escolhemos#revisao" className="text-sm text-fg underline underline-offset-2">
              Como revisamos
            </Link>
          </Q>
        )}

        <Q title="Em que pé está, quando decidem e quem decide?">
          {p.schedule.length > 0 ? (
            <>
              <p className="lbl">Próxima decisão</p>
              <ul className="flex flex-col gap-1">
                {p.schedule.map((s) => (
                  <li key={`${s.scheduledFor}-${s.committee}`}>
                    <strong>{dayLong(s.scheduledFor)}</strong>, a partir das {time(s.scheduledFor)} · {where(s)}
                  </li>
                ))}
              </ul>
              {p.readAt && <p className="text-sm text-muted">Na pauta lida em {dateTime(p.readAt)}.</p>}
              {next && isUrgent(next.regime) && <p>Tem urgência: pedido aprovado para votar mais rápido.</p>}
            </>
          ) : (
            <p>Não há data marcada na última pauta lida.</p>
          )}
          <p className="lbl mt-2">Quem decide</p>
          <p>
            {d.who} {d.needs}
          </p>
          {p.votes.length > 0 && (
            <>
              <p className="lbl mt-2">Votações registradas</p>
              <ul className="flex flex-col gap-2">
                {p.votes.map((v) => (
                  <li key={v.id}>
                    <Link href={`/votacoes/${v.id}`} className="underline underline-offset-2">
                      {date(v.occurredAt)}: {v.description}
                    </Link>
                    {v.yes !== null && v.no !== null && (
                      <span className="text-muted">
                        {" "}
                        · Sim {count(v.yes)}, Não {count(v.no)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Q>

        <Q id="quem-decide" title="Como falo com quem decide?">
          <p className="text-sm text-muted">Aqui estão os caminhos oficiais. A mensagem é sua: não sugerimos texto.</p>
          {(next?.rapporteur ?? e.rapporteur) && (
            <p>
              <span className="text-muted">Relator, quem analisa a proposta e sugere a versão final: </span>
              {next?.rapporteur ?? e.rapporteur}
            </p>
          )}
          {p.authors.length > 0 && (
            <p>
              <span className="text-muted">Autoria: </span>
              {p.authors.slice(0, 3).map((a, i) => (
                <span key={a.slug}>
                  {i > 0 && ", "}
                  <Link href={`/p/${a.slug}`} className="underline underline-offset-2">
                    {a.name}
                  </Link>
                </span>
              ))}
              . Os contatos estão no perfil.
            </p>
          )}
          <p>
            <Link href="/representantes" className="font-semibold text-fg underline underline-offset-2">
              Ver quem representa sua cidade
            </Link>
            <span className="text-muted"> · deputados federais e senadores do seu estado, com contato oficial, em ordem alfabética.</span>
          </p>
        </Q>

        <Q id="texto-oficial" title="Texto oficial">
          {p.fichaUrl ? (
            <a href={p.fichaUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              Ficha da proposta, com o inteiro teor · site {ofBody(e.body)}
            </a>
          ) : (
            <p className="text-muted">O link da ficha não veio na pauta desta comissão. Busque {label(e)} no site {ofBody(e.body)}.</p>
          )}
        </Q>
      </div>

      <AboutData
        readAt={p.readAt}
        extra={
          p.answers && (
            <p className="mt-2 max-w-[65ch] text-sm text-muted">
              Respostas rascunhadas por IA a partir do texto oficial. {conferidoEm(p.answers.reviewedAt, p.answers.verifiedBy, "v1")}.
              {p.answers.correction && <> Corrigidas em {date(p.answers.correction.correctedAt)}: {p.answers.correction.note}</>}
            </p>
          )
        }
      />
    </Container>
  );
}
