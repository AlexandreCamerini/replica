import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EXEMPLOS, GLOSSARIO, KIND_LABEL, type ImpactAnswer, type Kind } from "@/components/sv/exemplos";
import { BODY_NAME, billLabel, clip, fmtDate, fmtDateTime, fmtWeekday } from "@/components/sv/fmt";
import { Gap, Item, Label, List, Section, Src, Steps } from "@/components/sv/ui";
import { data, type AnswerClaim, type PautaProposal, type PublishedAnswers } from "@/lib/data";

const KEY = /^[a-z0-9-]{3,80}$/;
const load = (key: string) => (KEY.test(key) ? data.getPautaProposal(key) : Promise.resolve(null));

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const p = await load((await params).key);
  return { title: p ? billLabel(p.entry) : "Decisão não encontrada" };
}

function statusLine(p: PautaProposal): string | null {
  switch (p.status.kind) {
    case "saiu":
      return `Saiu da pauta em ${fmtDate(p.status.at)}. A fonte não informa o motivo.`;
    case "reuniao_encerrada":
      return `A reunião de ${fmtDate(p.status.at)} foi encerrada. O resultado ainda não consta.`;
    case "reuniao_cancelada":
      return `A reunião de ${fmtDate(p.status.at)} foi cancelada.`;
    case "sem_leitura":
      return `Vista pela última vez na pauta em ${fmtDate(p.status.lastSeenAt)}.`;
    default:
      return null;
  }
}

// O que falta para valer, em palavras, conforme a etapa.
const NEXT: Record<"comissao" | "plenario", string> = {
  comissao: "Falta a comissão votar. Depois vêm o plenário, a outra Casa do Congresso e a assinatura do presidente.",
  plenario: "Falta o plenário votar. Depois vêm a outra Casa do Congresso e a assinatura do presidente.",
};

/** Resposta revisada vira uma pergunta do cidadão: a frase, o tipo de afirmação e o trecho oficial que a sustenta. */
function fromClaim(q: string, c: AnswerClaim): ImpactAnswer {
  return c.says ? { q, a: c.text, kind: "texto", quote: c.quote ? `p. ${c.page}: ${c.quote}` : undefined } : { q, a: "O texto oficial não trata disso.", kind: "nao_sabemos" };
}

function reviewedAnswers(a: PublishedAnswers): ImpactAnswer[] {
  return [fromClaim("Quem é afetado?", a.fields.quem_recebe), fromClaim("O que muda na prática?", a.fields.o_que_muda), fromClaim("Quem paga a conta?", a.fields.quem_paga), fromClaim("Quanto dinheiro envolve?", a.fields.dinheiro)];
}

const EMPTY: ImpactAnswer[] = ["Quem é afetado?", "O que muda na prática?", "Quem paga a conta?", "Quando começaria a valer?"].map((q) => ({ q, a: "Ainda não conseguimos conferir esta resposta.", kind: "nao_sabemos" as Kind }));

// As cinco conferências da verificação agêntica (replica/verificacao-agentica.md).
const CHECKS = [
  { name: "O trecho existe", what: "Um programa confere que cada trecho citado está, palavra por palavra, no texto oficial." },
  { name: "O trecho sustenta a frase", what: "Um agente que não viu a redação compara cada frase com o trecho e a página de onde ele saiu." },
  { name: "Nada contradiz", what: "Outro agente lê o texto inteiro à procura de condição, prazo ou exceção que a frase tenha deixado de fora." },
  { name: "Dá para entender", what: "Um agente no papel de leitor comum lê só as frases e responde o que muda, para quem e se já vale." },
  { name: "Sem juízo", what: "Um programa barra palavras que dizem se a proposta é boa ou ruim." },
];

function Question({ x }: { x: ImpactAnswer }) {
  return (
    <div className="sv-q">
      <h3>{x.q}</h3>
      <p style={x.kind === "nao_sabemos" ? { fontWeight: 300 } : undefined}>{x.a}</p>
      <span className={`sv-kind ${x.kind === "texto" ? "is-texto" : x.kind === "previsao" ? "is-previsao" : "is-nao"}`}>{KIND_LABEL[x.kind]}</span>
      {x.quote && (
        <details>
          <summary>Ver o trecho do texto oficial</summary>
          <p className="sv-quote">“{x.quote}”</p>
        </details>
      )}
    </div>
  );
}

export default async function Decisao({ params }: { params: Promise<{ key: string }> }) {
  const p = await load((await params).key);
  if (!p) notFound();
  const e = p.entry;
  const a = p.answers;
  // Redação de demonstração: só na versão de demonstração e só quando não há resposta revisada.
  const ex = !a && data.isDemo ? (EXEMPLOS[e.key] ?? null) : null;
  const step = e.stage === "plenario" ? 2 : 1;
  const where = e.stage === "plenario" ? `O plenário ${e.body === "camara" ? "da Câmara" : "do Senado"}, com todos os parlamentares da Casa` : `A comissão ${e.committee ?? ""} ${e.body === "camara" ? "da Câmara" : "do Senado"}`.replace("  ", " ");
  const status = statusLine(p);

  const title = e.plain ?? ex?.title ?? billLabel(e);
  const oneLine = a?.fields.o_que_propoe.says ? a.fields.o_que_propoe.text : (ex?.oneLine ?? null);
  const answers = a ? reviewedAnswers(a) : (ex?.answers ?? EMPTY);

  return (
    <>
      <div className="sv-grid is-7-5">
        <div>
          <Label>{e.reason.theme ?? "Proposta"}</Label>
          <h1 className="sv-title sv-mt-1">{title}</h1>
          <p className="sv-meta sv-mt-2">
            {billLabel(e)}, {BODY_NAME[e.body]}
            {p.presentedOn ? `. Apresentada em ${fmtDate(p.presentedOn)}` : ""}
          </p>

          {ex && <span className="sv-tag sv-mt-3">Exemplo ilustrativo: redação de demonstração</span>}

          {oneLine ? (
            <p className="sv-lead sv-mt-3">{oneLine}</p>
          ) : (
            <>
              <p className="sv-lead sv-mt-3" style={{ fontSize: 17 }}>
                {e.summary ?? "A fonte não publicou o resumo desta proposta."}
              </p>
              <p className="sv-meta sv-mt-1" style={{ fontWeight: 400 }}>
                Este é o resumo oficial, na linguagem da lei. A explicação simples só aparece depois de conferida com o texto oficial, frase por frase, por agentes de IA.
              </p>
            </>
          )}

          <p className="sv-status sv-mt-3">É uma proposta. Ainda não é lei.</p>
          <Steps now={step} />
          <p className="sv-mt-2" style={{ fontSize: 15.5, lineHeight: 1.4 }}>
            {NEXT[e.stage]}
          </p>
          {status && <p className="sv-meta sv-mt-2">{status}</p>}
        </div>

        <div>
          <Section label="Quem decide agora" first>
            <p>
              {where}. Reunião: {fmtWeekday(e.scheduledFor)}.
            </p>
            {e.rapporteur && <p>Relator, que sugere a versão final: {e.rapporteur}.</p>}
          </Section>

          <Section label="Quem propôs">
            {p.authors.length === 0 ? (
              <Gap>Não consta. A autoria ainda não foi carregada; está no texto oficial.</Gap>
            ) : (
              <List>
                {p.authors.map((au) => (
                  <Item key={au.slug} href={`/v2/pessoa/${au.slug}`} title={au.name} value={au.role === "principal" ? "autoria principal" : "coautoria"} />
                ))}
              </List>
            )}
          </Section>

          <Section label="Onde verificar">
            {p.fichaUrl ? (
              <p>
                <a href={p.fichaUrl} rel="noopener noreferrer">
                  Texto oficial e tramitação na {BODY_NAME[e.body]}
                </a>
              </p>
            ) : (
              <Gap>O endereço do texto oficial ainda não foi carregado.</Gap>
            )}
            {oneLine && e.summary && (
              <details>
                <summary>Ler o resumo oficial, na linguagem da lei</summary>
                <p className="sv-quote">{e.summary}</p>
              </details>
            )}
          </Section>
        </div>
      </div>

      {/* O centro da página: a decisão traduzida para a vida de quem lê. */}
      <section className="sv-impact" aria-labelledby="h-impacto">
        <Label>Em linguagem simples</Label>
        <h2 id="h-impacto" className="sv-mt-1">
          Como isso mexe com a sua vida
        </h2>
        <div className="sv-qa">
          {answers.map((x) => (
            <Question key={x.q} x={x} />
          ))}
        </div>
        <p className="sv-meta" style={{ fontWeight: 400, padding: "4px 0 14px" }}>
          {a
            ? `Conferido com o texto oficial por agentes de IA em ${fmtDate(a.reviewedAt)}. Dizemos o que o texto faz, nunca se é bom ou ruim.`
            : ex
              ? "Nesta demonstração as respostas são um exemplo de redação. No site real, cada uma só aparece depois de conferida com o texto oficial por agentes de IA."
              : "Cada resposta só aparece depois de conferida com o texto oficial por agentes de IA. Dizemos o que o texto faz, nunca se é bom ou ruim."}
        </p>
        <details style={{ paddingBottom: 14 }}>
          <summary>Como esta página é conferida</summary>
          <ol className="sv-checks">
            {CHECKS.map((c) => (
              <li key={c.name}>
                <b>{c.name}.</b> {c.what}
              </li>
            ))}
          </ol>
          <p className="sv-meta" style={{ fontWeight: 400 }}>
            Um agente escreve e outros, independentes, conferem. Se uma conferência falha, a resposta não é publicada e aparece como “ainda não conseguimos conferir”. Nenhuma pessoa lê esta explicação antes de publicarmos: se você vir um erro, <Link href="/v2/como-funciona#correcoes">aponte</Link>, e corrigimos com data e motivo.
          </p>
        </details>
      </section>

      <div className="sv-grid is-7-5 sv-mt-5">
        <div>
          <Label>Palavras que aparecem aqui</Label>
          <dl className="sv-gloss">
            {GLOSSARIO.map((g) => (
              <div key={g.termo}>
                <dt>{g.termo}</dt>
                <dd>{g.def}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <Label>Por que esta proposta está aqui</Label>
          <p className="sv-mt-1" style={{ fontSize: 15.5, lineHeight: 1.4 }}>
            {e.reason.theme ? `A Casa a classificou em “${e.reason.theme}” e ` : ""}o resumo oficial cita “{e.reason.term}”. <Link href="/v2/como-funciona#regras">Ver a regra</Link>
          </p>
          {p.votes.length > 0 && (
            <div className="sv-mt-4">
              <Label>Votações desta proposta</Label>
              <List>
                {p.votes.map((v) => (
                  <Item key={v.id} href={`/v2/votacao/${v.id}`} title={clip(v.description, 150)} note={v.yes !== null && v.no !== null ? `${v.yes} sim, ${v.no} não` : "Placar não publicado"} value={fmtDate(v.occurredAt)} />
                ))}
              </List>
            </div>
          )}
        </div>
      </div>

      {a?.correction && (
        <p className="sv-meta sv-mt-4">
          Corrigido em {fmtDate(a.correction.correctedAt)}: {a.correction.note} <Link href="/v2/como-funciona#correcoes">Ver todas as correções</Link>
        </p>
      )}

      <Src>
        Fonte: {BODY_NAME[e.body]}, pauta{p.readAt ? ` lida em ${fmtDateTime(p.readAt)}` : " ainda não lida"}.{a ? ` Explicação conferida com o texto oficial por agentes de IA em ${fmtDate(a.reviewedAt)}.` : " Explicação aguardando conferência."}
      </Src>
    </>
  );
}
