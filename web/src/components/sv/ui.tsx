import Link from "next/link";
import type { ReactNode } from "react";
import type { AnswerClaim, CoverageStatus, VerifiedBy, VoteValue } from "@/lib/data";
import { AFIRMACAO, JA_VALE, SELO, SELO_HREF, conferidoEm, fraseCobertura, fraseSemAfirmacao, type JaValeEstado } from "./estados";
import { fmtDateTime } from "./fmt";

// Componentes do sistema Segue o Voto. As classes vêm de src/styles/sv.css; a regra de uso de cada um está no design system.

export function Label({ children }: { children: ReactNode }) {
  return <p className="sv-label">{children}</p>;
}

/** Linha de lista com régua. `on` marca um valor afirmativo (peso 800). */
export function Row({ href, label, value, on }: { href?: string; label: ReactNode; value?: ReactNode; on?: boolean }) {
  const inner = (
    <>
      {label}
      {value !== undefined && <span className={on ? "is-on" : undefined}>{value}</span>}
    </>
  );
  return href ? (
    <Link className="sv-row" href={href}>
      {inner}
    </Link>
  ) : (
    <div className="sv-row">{inner}</div>
  );
}

/** Item de lista com título, linha de apoio e um valor à direita. */
export function Item({ href, title, note, value, on }: { href?: string; title: ReactNode; note?: ReactNode; value?: ReactNode; on?: boolean }) {
  const inner = (
    <>
      <div>
        {title}
        {note && <small>{note}</small>}
      </div>
      {value !== undefined && <span className={on ? "is-on" : undefined}>{value}</span>}
    </>
  );
  return href ? (
    <Link className="sv-item" href={href}>
      {inner}
    </Link>
  ) : (
    <div className="sv-item">{inner}</div>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <div className="sv-list">{children}</div>;
}

/** Lacuna declarada: o que a fonte não publica ou ainda não foi carregado. Nunca vira zero. */
export function Gap({ children }: { children: ReactNode }) {
  return <p className="sv-gap">{children}</p>;
}

export function Section({ label, children, first }: { label: string; children: ReactNode; first?: boolean }) {
  return (
    <div className="sv-sec" style={first ? { marginTop: 0 } : undefined}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** Bloco de destaque: a única superfície escura da tela. */
export function Block({ href, label, title, children, bleed, className }: { href?: string; label: string; title: ReactNode; children?: ReactNode; bleed?: boolean; className?: string }) {
  const cls = ["sv-block", bleed ? "is-bleed" : "", className ?? ""].filter(Boolean).join(" ");
  const inner = (
    <>
      <Label>{label}</Label>
      <h2>{title}</h2>
      {children}
    </>
  );
  return href ? (
    <Link className={cls} href={href}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

export function Notice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sv-notice" role="status">
      <Label>{label}</Label>
      <p>{children}</p>
    </div>
  );
}

export function Src({ children }: { children: ReactNode }) {
  return <p className="sv-src">{children}</p>;
}

const STEPS = ["proposta", "comissão", "plenário", "senado", "sanção", "em vigor"] as const;

/** Linha de vida da decisão. `now` é o índice da etapa atual (0 a 5). */
export function Steps({ now }: { now: number }) {
  return (
    <ul className="sv-steps" aria-label={`Etapa ${now + 1} de ${STEPS.length}: ${STEPS[now]}`}>
      {STEPS.map((s, i) => (
        <li key={s} className={i < now ? "is-done" : i === now ? "is-now" : undefined}>
          {s}
        </li>
      ))}
    </ul>
  );
}

// Voto é forma mais palavra, nunca cor nem peso: todas as palavras no mesmo peso (neutralidade).
// Obstrução e "presidia" são registros próprios da Casa: levam a forma vazia e a palavra exata.
const VOTE: Record<VoteValue, { word: string; mark: string }> = {
  sim: { word: "Sim", mark: "is-sim" },
  nao: { word: "Não", mark: "is-nao" },
  abstencao: { word: "Abstenção", mark: "is-abs" },
  obstrucao: { word: "Obstrução", mark: "" },
  art17: { word: "Presidia", mark: "" },
  nao_votou: { word: "Sem voto", mark: "" },
};

export const voteWord = (v: VoteValue) => VOTE[v].word;

export function VoteMark({ value }: { value: VoteValue }) {
  const v = VOTE[value];
  return (
    <span className="sv-vote">
      <i className={`sv-mark ${v.mark}`} aria-hidden="true" />
      {v.word}
    </span>
  );
}

/** Uma barra do placar. A largura é a parcela de `total`. */
export function Bar({ label, kind, weight, n, total }: { label: string; kind?: "is-sim" | "is-nao" | "is-abs"; weight: number; n: number; total: number }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (n / total) * 100)) : 0;
  return (
    <div className="sv-bar">
      <b style={{ fontWeight: weight }}>{label}</b>
      <div className="sv-track">{kind && n > 0 && <i className={kind} style={{ width: `${pct}%` }} />}</div>
      <span>{n}</span>
    </div>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav className="sv-tabs" aria-label="Seções">
      {items.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/* =====================================================================================================================
   Direção 2: primitivas das telas novas (server components, sem JS). Classes em src/styles/sv.css; frases em ./estados.ts.
   "Exemplo ilustrativo" fica em ./etiqueta.tsx (lê data.isDemo e só aparece na demonstração).
   ===================================================================================================================== */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type QuadroVariante = "padrao" | "fio" | "lacuna" | "dom";

/** Pergunta numerada (`.sv-p` + `.sv-n`). `vida` pinta o número em --vida: só "O que muda para mim?" e "Isso é comigo?". */
export function Pergunta({ id, numero, vida, as: Tag = "h2", children }: { id?: string; numero?: number | string; vida?: boolean; as?: "h2" | "h3" | "span"; children: ReactNode }) {
  return (
    <Tag className="sv-p" id={id}>
      {numero !== undefined && <span className={cx("sv-n", vida && "sv-n--vida")}>{numero}</span>}
      {children}
    </Tag>
  );
}

/** Quadro de pergunta: <section> rotulada pela própria pergunta (h2), filhos e a prova (fonte e data) no pé. */
export function Quadro({
  id,
  variante = "padrao",
  numero,
  vida,
  pergunta,
  rotulo,
  prova,
  className,
  children,
}: {
  /** id do h2; a section usa aria-labelledby. Obrigatório e único na página. */
  id: string;
  variante?: QuadroVariante;
  numero?: number | string;
  vida?: boolean;
  /** sem pergunta (ex.: quadro de lacunas com várias perguntas dentro), passe `rotulo` para o aria-label */
  pergunta?: ReactNode;
  rotulo?: string;
  prova?: ReactNode;
  /** área de grade da tela, ex.: "sv-ga" */
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={cx("sv-quadro", variante !== "padrao" && `sv-quadro--${variante}`, className)} {...(pergunta ? { "aria-labelledby": id } : { "aria-label": rotulo, id })}>
      <div className="sv-quadro__in">
        {pergunta && (
          <Pergunta id={id} numero={numero} vida={vida}>
            {pergunta}
          </Pergunta>
        )}
        {children}
        {prova && <Prova>{prova}</Prova>}
      </div>
    </section>
  );
}

export type RespostaTamanho = "padrao" | "xl" | "dom" | "fala" | "m" | "r";

/** A resposta grande de um quadro (`.sv-a`). Tamanhos: padrao, xl ("Já vale?"), dom (quadro dominante), fala, m, r (linha tripla). */
export function Resposta({ tamanho = "padrao", as: Tag = "p", children }: { tamanho?: RespostaTamanho; as?: "p" | "div"; children: ReactNode }) {
  return <Tag className={cx("sv-a", tamanho !== "padrao" && `sv-a--${tamanho}`)}>{children}</Tag>;
}

/** Prova no pé do quadro: fonte e data de leitura, com fio acima. */
export function Prova({ children }: { children: ReactNode }) {
  return <p className="sv-prova">{children}</p>;
}

/** Fonte solta (linha tripla, legenda de tabela): "Fonte: …, lida em …". */
export function Fonte({ children }: { children: ReactNode }) {
  return <p className="sv-fonte">{children}</p>;
}

/** Nota de rodapé de quadro, em tinta2 e 13px. */
export function Nota({ children }: { children: ReactNode }) {
  return <p className="sv-nota">{children}</p>;
}

/** Etiqueta de palavra (peso 800, sem contorno), ex.: "Aguardando conferência". Para "Exemplo ilustrativo", use <ExemploIlustrativo/>. */
export function Etiqueta({ children }: { children: ReactNode }) {
  return <span className="sv-etq">{children}</span>;
}

/** Lacuna nomeada: contorno tracejado, fundo liso. Nunca "0". `motivo` vai em linha menor abaixo. */
export function Lacuna({ children, motivo }: { children?: ReactNode; motivo?: ReactNode }) {
  return (
    <p className="sv-lac">
      <span className="sv-lac__liso">
        {children ?? fraseCobertura(null)}
        {motivo && <span className="sv-sm">{motivo}</span>}
      </span>
    </p>
  );
}

/**
 * Status de cobertura de um conjunto (presença, votos, gastos…). Só fala de status quando ele veio do contrato;
 * `no_site` (lido) não rende nada: a tela mostra o dado. Sem status: "Ainda não temos esse dado." + fonte nomeada.
 */
export function Cobertura({ status, motivo, fonte }: { status?: CoverageStatus | null; motivo?: ReactNode; fonte: ReactNode }) {
  const frase = fraseCobertura(status);
  if (frase === null) return null;
  return (
    <>
      <Lacuna motivo={motivo}>{frase}</Lacuna>
      <Fonte>Fonte: {fonte}.</Fonte>
    </>
  );
}

/**
 * Uma afirmação sobre a proposta, nos três estados do contrato (§6). `claim` null = proposta sem respostas publicadas:
 * "Aguardando conferência". `diz`: frase + trecho + quem conferiu (`conferidoEm`, por `verifiedBy`).
 */
export function Afirmacao({
  claim,
  conferidaEm,
  conferidaPor = null,
  tamanho = "m",
}: {
  claim: AnswerClaim | null;
  /** `PublishedAnswers.reviewedAt` */
  conferidaEm: string | null;
  /** `PublishedAnswers.verifiedBy` */
  conferidaPor?: VerifiedBy;
  tamanho?: RespostaTamanho;
}) {
  if (!claim) return <Lacuna>{AFIRMACAO.aguardando}</Lacuna>;
  if (claim.state === "diz" && claim.says)
    return (
      <>
        <Resposta tamanho={tamanho}>{claim.text}</Resposta>
        <p className="sv-t">
          “{claim.quote}”{claim.page > 0 ? ` (p. ${claim.page})` : ""}
        </p>
        {conferidaEm && <p className="sv-conf">{conferidoEm(conferidaEm, conferidaPor)}.</p>}
      </>
    );
  if (claim.state === "nao_diz") return <Resposta tamanho={tamanho}>{fraseSemAfirmacao("nao_diz")}</Resposta>;
  return <Lacuna>{fraseSemAfirmacao(claim.state)}</Lacuna>;
}

// Voto: quadrado + palavra, nunca cor. Ordem fixa nas legendas e placares: Sim, Não, Abstenção, Sem voto.
export type VotoForma = "sim" | "nao" | "abs" | "sem";
export const VOTO_ORDEM = ["sim", "nao", "abs", "sem"] as const satisfies readonly VotoForma[];
const VOTO_PALAVRA: Record<VotoForma, string> = { sim: "Sim", nao: "Não", abs: "Abstenção", sem: "Sem voto" };
const FORMA_DE: Record<VoteValue, VotoForma> = { sim: "sim", nao: "nao", abstencao: "abs", obstrucao: "sem", art17: "sem", nao_votou: "sem" };
// Obstrução e "presidia" são registros da Casa: forma vazia, palavra exata.
const PALAVRA_DE: Partial<Record<VoteValue, string>> = { obstrucao: "Obstrução", art17: "Presidia" };

/** Só o quadrado (decorativo). Use dentro de uma célula que já tem a palavra. */
export function VotoQuadrado({ forma }: { forma: VotoForma }) {
  return <i className={cx("sv-m", forma !== "sem" && `sv-m--${forma}`)} aria-hidden="true" />;
}

/** Voto de uma pessoa ou categoria do placar: forma + palavra. Aceita o valor do contrato (`voto`) ou a forma direta (`forma`). */
export function VotoMarca(p: { voto: VoteValue } | { forma: VotoForma }) {
  const forma = "voto" in p ? FORMA_DE[p.voto] : p.forma;
  const palavra = "voto" in p ? (PALAVRA_DE[p.voto] ?? VOTO_PALAVRA[forma]) : VOTO_PALAVRA[forma];
  return (
    <span className="sv-voto">
      <VotoQuadrado forma={forma} />
      {palavra}
    </span>
  );
}

/** "Já vale?": círculo (cheio / tracejado / cortado) + frase. Em quadro "Já vale?", use dentro de <Resposta tamanho="xl">. */
export function JaVale({ estado, frase }: { estado: JaValeEstado; /** frase própria do tipo (ex.: "Já vale, por enquanto."), de sv/vigencia */ frase?: string }) {
  return (
    <span className="sv-vale">
      <i className={`sv-vf sv-vf--${estado}`} aria-hidden="true" />
      {frase ?? JA_VALE[estado].frase}
    </span>
  );
}

/** Legenda dos três estados de "Já vale?", sempre na mesma ordem. */
export function JaValeLegenda() {
  return (
    <p className="sv-leg">
      {(["ja", "ainda", "nao"] as const).map((e) => (
        <span key={e}>
          <i className={`sv-vf sv-vf--${e}`} aria-hidden="true" />
          {JA_VALE[e].legenda}
        </span>
      ))}
    </p>
  );
}

/**
 * Placar de uma votação: tabela forma + palavra + número, ordem fixa Sim, Não, Abstenção, Sem voto.
 * Número null = lacuna nomeada, nunca 0. `titulo` vira a legenda (caption) acessível.
 */
export function Placar({ titulo, sim, nao, abs, sem, total }: { titulo: string; sim: number | null; nao: number | null; abs: number | null; sem: number | null; total?: number | null }) {
  const n = { sim, nao, abs, sem };
  return (
    <table className="sv-cont">
      <caption className="sv-vh">{titulo}</caption>
      <thead className="sv-vh">
        <tr>
          <th scope="col">Voto</th>
          <th scope="col">Votos registrados</th>
        </tr>
      </thead>
      <tbody>
        {VOTO_ORDEM.map((f) => (
          <tr key={f}>
            <th scope="row">
              <VotoQuadrado forma={f} />
              {VOTO_PALAVRA[f]}
            </th>
            <td>
              {n[f] === null ? (
                fraseCobertura(null)
              ) : (
                <>
                  <b>{n[f]}</b>
                  {total ? ` de ${total}` : ""}
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Selo "Quem conferiu isso?". Só diz quem conferiu com a resposta publicada da própria página (`resposta`: `reviewedAt` e
 * `verifiedBy`), pela mesma frase de `conferidoEm`. Sem `resposta`, diz a regra, que vale sempre; com `resposta: null`
 * (página de uma proposta ainda sem resposta), diz que ainda não há resposta publicada. Data da leitura das fontes; links.
 */
export function Selo({
  id = "quem-conferiu",
  numero,
  lidoEm,
  resposta,
  className,
}: {
  id?: string;
  numero?: number | string;
  lidoEm?: string | null;
  /** omitido: página sem uma resposta própria; null: proposta sem resposta publicada */
  resposta?: { em: string; por: VerifiedBy } | null;
  className?: string;
}) {
  return (
    <Quadro id={id} variante="fio" numero={numero} pergunta={SELO.pergunta} className={className}>
      {resposta ? (
        <Resposta tamanho="m">{conferidoEm(resposta.em, resposta.por)}.</Resposta>
      ) : resposta === null ? (
        <Resposta tamanho="m">{SELO.semResposta}</Resposta>
      ) : (
        <Resposta tamanho="m">{SELO.regra}</Resposta>
      )}
      {resposta !== undefined && <p className="sv-t">{SELO.regra}</p>}
      {lidoEm && <p className="sv-t">Leitura das fontes: {fmtDateTime(lidoEm)}.</p>}
      <p className="sv-selo__l">
        <Link href={SELO_HREF.verConferido}>{SELO.verConferido}</Link>
        <Link href={SELO_HREF.apontarErro}>{SELO.apontarErro}</Link>
      </p>
    </Quadro>
  );
}

/** "Próxima pergunta": o quadro inteiro é um link para a próxima tela. */
export function Proxima({ href, pergunta, className }: { href: string; pergunta: string; className?: string }) {
  return (
    <Link className={cx("sv-quadro", "sv-quadro--prox", className)} href={href}>
      <span className="sv-quadro__in">
        <span className="sv-p">Próxima pergunta</span>
        <span className="sv-a">{pergunta}</span>
        <span className="sv-seta" aria-hidden="true">
          →
        </span>
      </span>
    </Link>
  );
}
