import Link from "next/link";
import type { ReactNode } from "react";
import { ESTADO_COBERTURA, FALHOU_LEITURA, naoHaNaLeitura } from "../estados";
import { clip, fmtDate } from "../fmt";
import { Cobertura, Fonte, Lacuna, Nota, Quadro, Resposta, VotoMarca, VotoQuadrado, type VotoForma } from "../ui";
import type { CoberturaConjunto } from "@/lib/data";
import type { Casa, Escolhido, Recente } from "./carregar";

const brl = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(cents / 100);
const fonteDe = (c: Casa, o: string) => `${c.nome}, ${o}${c.lidaEm ? `, lida em ${c.lidaEm}` : ""}`;
/** Fonte de uma linha com dado: com o conjunto lido, a fonte e a data da carga da família dele (não o carimbo mais novo da casa). */
const fonteCob = (c: Casa, o: string, cob: CoberturaConjunto | null | undefined) =>
  cob?.estado === "lido" && cob.lidoEm ? `${cob.fonte?.nome ?? c.nome}, ${o}, lida em ${fmtDate(cob.lidoEm)}` : fonteDe(c, o);

/** Linha tripla com dado: pergunta | resposta | fonte. */
function Linha({ id, pergunta, fonte, children }: { id: string; pergunta: string; fonte: string; children: ReactNode }) {
  return (
    <div className="sv-r3l">
      <h3 className="sv-r3l__q" id={id}>
        {pergunta}
      </h3>
      <div className="sv-r3l__a" aria-labelledby={id} role="group">
        {children}
      </div>
      <Fonte>Fonte: {fonte}.</Fonte>
    </div>
  );
}

/**
 * Linha tripla sem dado. Precedência: `motivo` (ex.: ainda não tomou posse) e `falhou` (leitura que falhou), que nunca viram
 * "nenhum"; depois o estado de cobertura da pessoa (getPeopleCoverage): `lido` = não há registro na leitura (com a data),
 * outro estado = a frase do estado e o motivo; sem cobertura lida, "Ainda não temos esse dado." + fonte nomeada.
 */
function LinhaLacuna({
  pergunta,
  fonte,
  cob,
  oQue,
  motivo,
  falhou,
}: {
  pergunta: string;
  fonte: string;
  cob?: CoberturaConjunto | null;
  /** o que falta, para a frase de "não há" ("presença registrada", "voto nominal de lei"…) */
  oQue: string;
  motivo?: string | null;
  falhou?: boolean;
}) {
  return (
    <div className="sv-r3l">
      <h3 className="sv-r3l__q">{pergunta}</h3>
      {motivo ? (
        <>
          <Lacuna>{motivo}</Lacuna>
          <Fonte>Fonte: {fonte}.</Fonte>
        </>
      ) : falhou ? (
        <>
          <Lacuna>{FALHOU_LEITURA}</Lacuna>
          <Fonte>Fonte: {fonte}.</Fonte>
        </>
      ) : cob?.estado === "lido" ? (
        <>
          <Lacuna estado="lido">{naoHaNaLeitura(oQue, cob.lidoEm)}</Lacuna>
          <Fonte>Fonte: {cob.fonte?.nome ?? fonte}.</Fonte>
        </>
      ) : cob ? (
        <>
          <Lacuna motivo={cob.motivo} estado={cob.estado}>
            {ESTADO_COBERTURA[cob.estado]}
          </Lacuna>
          <Fonte>Fonte: {cob.fonte?.nome ?? fonte}.</Fonte>
        </>
      ) : (
        <Cobertura fonte={fonte} />
      )}
    </div>
  );
}

const Ap = ({ children }: { children: ReactNode }) => <span className="sv-t sv-esc__ap">{children}</span>;

function Presenca({ p }: { p: Escolhido }) {
  const g = p.presenca;
  const q = "Foi trabalhar?";
  const fonte = fonteCob(p.casa, "presença", p.cobertura?.presenca);
  if (g.total <= 0) return <LinhaLacuna pergunta={q} fonte={fonte} cob={p.cobertura?.presenca} oQue={`presença em sessão de votação em ${p.ano}`} motivo={p.posse} falhou={p.falhou.presenca} />;
  const faltas = g.absent + g.justified;
  return (
    <Linha id={`${p.slug}-q1`} pergunta={q} fonte={fonte}>
      Esteve em {g.present} das {g.total} sessões de votação de {g.year}.
      <Ap>{faltas === 0 ? "Não faltou a nenhuma." : `Faltou a ${faltas}: ${g.justified} com justificativa e ${g.absent} sem.`}</Ap>
    </Linha>
  );
}

function Votos({ p }: { p: Escolhido }) {
  const q = "Como votou?";
  const fonte = fonteCob(p.casa, "votações nominais", p.cobertura?.votos);
  if (p.votos.total <= 0 || p.votos.items.length === 0) return <LinhaLacuna pergunta={q} fonte={fonte} cob={p.cobertura?.votos} oQue="voto nominal em lei" motivo={p.posse} falhou={p.falhou.votos} />;
  return (
    <Linha id={`${p.slug}-q2`} pergunta={q} fonte={fonte}>
      <ul className="sv-esc__vv">
        {p.votos.items.map((v) => (
          <li key={v.id}>
            <p className="sv-esc__vv-v">
              <VotoMarca voto={v.valor} />
            </p>
            <p className="sv-esc__vv-t">
              <Link href={`/v2/votacao/${v.id}`}>{fmtDate(v.em)}</Link> · {clip(v.texto, 110)}
            </p>
          </li>
        ))}
      </ul>
      <Ap>Sem voto: não é voto contra.</Ap>
    </Linha>
  );
}

function Gastos({ p }: { p: Escolhido }) {
  const q = "Quanto gastou o gabinete?";
  const fonte = fonteCob(p.casa, "cota para o exercício do mandato", p.cobertura?.gastos);
  if (p.gastoCents === null) return <LinhaLacuna pergunta={q} fonte={fonte} cob={p.cobertura?.gastos} oQue={`gasto de gabinete em ${p.ano}`} motivo={p.posse} falhou={p.falhou.gastos} />;
  return (
    <Linha id={`${p.slug}-q3`} pergunta={q} fonte={fonte}>
      {brl(p.gastoCents)} em {p.ano}, até a última leitura.
      <Ap>É a cota para o exercício do mandato: dinheiro público.</Ap>
    </Linha>
  );
}

function Patrimonio({ p }: { p: Escolhido }) {
  const q = "O patrimônio declarado mudou?";
  const fonte = fonteCob(p.tse, "bens declarados nas candidaturas", p.cobertura?.patrimonio);
  const v = p.patrimonio;
  if (v.length === 0) return <LinhaLacuna pergunta={q} fonte={fonte} cob={p.cobertura?.patrimonio} oQue="bens declarados nas candidaturas" falhou={p.falhou.patrimonio} />;
  const lista = v.map((x) => `${brl(x.cents)} em ${x.ano}`).join(", ");
  const abertura = v.length === 1 ? "Só um valor declarado: não dá para dizer se mudou." : v.every((x) => x.cents === v[0].cents) ? "Não mudou entre as declarações." : "Mudou.";
  return (
    <Linha id={`${p.slug}-q4`} pergunta={q} fonte={fonte}>
      {abertura} {lista}.<Ap>São bens declarados à Justiça Eleitoral, não renda.</Ap>
    </Linha>
  );
}

function Propostas({ p }: { p: Escolhido }) {
  const q = "O que propôs?";
  const fonte = fonteCob(p.casa, "propostas", p.cobertura?.propostas);
  const pr = p.propostas;
  if (!pr) return <LinhaLacuna pergunta={q} fonte={fonte} cob={p.cobertura?.propostas} oQue="proposta apresentada" falhou={p.falhou.propostas} />;
  const partes = [pr.principal !== null && `${pr.principal} como autoria principal`, pr.coautor !== null && `${pr.coautor} em coautoria`].filter(Boolean).join(" e ");
  return (
    <Linha id={`${p.slug}-q5`} pergunta={q} fonte={fonte}>
      {partes}, no período carregado.
      {pr.leis !== null ? (
        <Ap>{pr.leis > 0 ? `${pr.leis} ${pr.leis === 1 ? "virou lei" : "viraram lei"}.` : "Nenhuma virou lei entre as que lemos."}</Ap>
      ) : (
        <Ap>{p.falhou.leis ? "Leis sancionadas: não conseguimos ler esta fonte agora." : "Leis sancionadas: ainda não temos esse dado para este cargo."}</Ap>
      )}
    </Linha>
  );
}

const temLacuna = (p: Escolhido) => p.presenca.total <= 0 || p.votos.total <= 0 || p.votos.items.length === 0 || p.gastoCents === null || p.patrimonio.length === 0 || !p.propostas;

/** Um quadro por pessoa. Todas levam a mesma estrutura de cinco perguntas, na mesma ordem, com a mesma moldura. */
export function QuadroEscolhido({ p }: { p: Escolhido }) {
  const sub = [p.cargo ?? (p.cargoFalhou ? "Não conseguimos ler o mandato agora" : "Cargo não carregado"), p.uf, p.partido, p.desde].filter(Boolean).join(" · ");
  return (
    <Quadro id={`esc-${p.slug}`} rotulo={p.nome}>
      <div className="sv-esc__h">
        <h2 className="sv-esc__hn">
          <span className="sv-esc__n">{p.nome}</span>
          <span className="sv-esc__c">{sub}</span>
          {p.esfera && <span className="sv-esc__e">Esfera: {p.esfera}</span>}
        </h2>
        <Link className="sv-esc__lk" href={`/v2/pessoa/${p.slug}`}>
          Ver tudo de {p.nome}&nbsp;<span aria-hidden="true">→</span>
        </Link>
      </div>
      {temLacuna(p) && <Nota>Ainda não temos esse dado não quer dizer que a pessoa não fez nada.</Nota>}
      <Presenca p={p} />
      <Votos p={p} />
      <Gastos p={p} />
      <Patrimonio p={p} />
      <Propostas p={p} />
    </Quadro>
  );
}

// ---- feed ----
const FORMA: Record<string, { forma: VotoForma; palavra: string }> = {
  sim: { forma: "sim", palavra: "Sim" },
  Sim: { forma: "sim", palavra: "Sim" },
  nao: { forma: "nao", palavra: "Não" },
  Não: { forma: "nao", palavra: "Não" },
  abstencao: { forma: "abs", palavra: "Abstenção" },
  Abstenção: { forma: "abs", palavra: "Abstenção" },
  obstrucao: { forma: "sem", palavra: "Obstrução" },
  Obstrução: { forma: "sem", palavra: "Obstrução" },
  art17: { forma: "sem", palavra: "Presidia" },
  "Art. 17": { forma: "sem", palavra: "Presidia" },
  nao_votou: { forma: "sem", palavra: "Sem voto" },
  "Não votou": { forma: "sem", palavra: "Sem voto" },
};
const TIPO = { voto: "voto", proposta: "proposta", gasto: "gasto" } as const;
const hrefDe = (h: string) => (h.startsWith("/votacoes/") ? h.replace("/votacoes/", "/v2/votacao/") : null);

function Texto({ r }: { r: Recente }) {
  const { item } = r;
  const nome = <b>{item.personName}</b>;
  if (item.kind === "voto") {
    const f = FORMA[item.detail ?? ""] ?? { forma: "sem" as const, palavra: item.detail ?? "Sem voto" };
    const href = hrefDe(item.href);
    const titulo = href ? <Link href={href}>{clip(item.title, 100)}</Link> : clip(item.title, 100);
    return (
      <>
        {nome} {f.palavra === "Sem voto" ? "ficou" : "votou"} <VotoQuadrado forma={f.forma} /> {f.palavra} em {titulo}.{f.palavra === "Sem voto" && " Sem voto: não é voto contra."}
      </>
    );
  }
  if (item.kind === "proposta") return <>{nome} consta na autoria de {clip(item.title, 100)}.</>;
  return (
    <>
      {nome} teve gasto registrado em {clip(item.title, 80)}
      {item.detail ? `: ${item.detail}` : ""}.
    </>
  );
}

/** "O que fizeram por último?": mais recente primeiro. Sem registro de "última visita" no produto, não há "desde". */
export function Recentes({ itens, falhou = false, lidoEm, className }: { itens: Recente[]; /** a leitura da atividade falhou */ falhou?: boolean; lidoEm: string | null; className?: string }) {
  return (
    <Quadro id="esc-recentes" variante="fio" pergunta="O que fizeram por último?" className={className} prova={`Mais recente primeiro. Fonte: registros oficiais de votos, propostas e gastos de cada pessoa${lidoEm ? `, lidos em ${fmtDate(lidoEm)}` : ""}.`}>
      {falhou ? (
        <Lacuna>{FALHOU_LEITURA}</Lacuna>
      ) : itens.length === 0 ? (
        <Lacuna>Ainda não temos registro recente destas pessoas.</Lacuna>
      ) : (
        <ol className="sv-esc__fd">
          {itens.map((r, i) => (
            <li key={`${r.item.personSlug}-${r.item.occurredAt}-${i}`}>
              <span className="sv-esc__fd-d">{fmtDate(r.item.occurredAt)}</span>
              <span className="sv-esc__fd-t">
                <Texto r={r} />
              </span>
              <span className="sv-esc__fd-k">{[TIPO[r.item.kind], r.esfera].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ol>
      )}
    </Quadro>
  );
}

/** Pessoas marcadas que não puderam ser lidas (falha) ou que a fonte não conhece mais: lacuna nomeada, nunca "ninguém marcado". */
export function EscolhidosNaoLidos({ falhas, naoEncontradas, className }: { falhas: number; naoEncontradas: number; className?: string }) {
  return (
    <Quadro id="esc-nao-lidos" variante="lacuna" rotulo="Pessoas que você marcou e que não aparecem" className={className}>
      {falhas > 0 && (
        <Lacuna motivo={falhas === 1 ? "1 pessoa que você marcou não pôde ser lida." : `${falhas} pessoas que você marcou não puderam ser lidas.`}>{FALHOU_LEITURA}</Lacuna>
      )}
      {naoEncontradas > 0 && (
        <Lacuna>{naoEncontradas === 1 ? "1 pessoa que você marcou não foi encontrada nos dados carregados." : `${naoEncontradas} pessoas que você marcou não foram encontradas nos dados carregados.`}</Lacuna>
      )}
    </Quadro>
  );
}

/** Estado vazio: cookie sem ninguém. */
export function SemEscolhidos({ className }: { className?: string }) {
  return (
    <Quadro id="esc-vazio" variante="lacuna" pergunta="Você ainda não marcou ninguém." className={className}>
      <Resposta tamanho="m">Abra a página de uma pessoa em quem você votou e use o botão “Votei nesta pessoa: acompanhar”.</Resposta>
      <p className="sv-t">Marcadas as pessoas, cada uma ganha um quadro aqui, com as mesmas cinco perguntas.</p>
      <p>
        <Link className="sv-btn" href="/v2/pessoas">
          Escolher em quem votei
        </Link>
      </p>
    </Quadro>
  );
}
