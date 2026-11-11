// Seções da tela Pessoa (D2). Server components, sem JS. Cada seção é uma linha tripla "pergunta | resposta | fonte" (sv-l3).
// Nada aqui escreve número, nome ou data: tudo vem do DataSource. Sem dado: lacuna nomeada, nunca zero.
import Link from "next/link";
import type { ReactNode } from "react";
import { clip, fmtDate, fmtInt } from "@/components/sv/fmt";
import { fraseCobertura, SEM_DADO } from "@/components/sv/estados";
import { Fonte, Lacuna, Pergunta, Resposta, VotoMarca } from "@/components/sv/ui";
import { CAMPAIGN_ORIGINS, type Amendment, type CampaignFinance, type Candidacy, type CommitteeItem, type CoverageStatus, type PersonVote } from "@/lib/data";
import { brl, brlCurto, listaE, MESES } from "./format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- moldura e estados ---------- */

/** Linha tripla. `ancora` é o id da section (links "Ir para"); o id do h2 é `${id}`. A fonte fica sempre no pé. */
export function Linha({ id, numero, pergunta, dom, ancora, fonte, children }: { id: string; numero?: number; pergunta: ReactNode; dom?: boolean; ancora?: string; fonte: ReactNode; children: ReactNode }) {
  return (
    <section className={cx("sv-l3", dom && "sv-l3--dom")} id={ancora} aria-labelledby={id}>
      <Pergunta id={id} numero={numero}>
        {pergunta}
      </Pergunta>
      {children}
      <Fonte>{fonte}</Fonte>
    </section>
  );
}

/** Lacuna: frase do status do contrato (ou "Ainda não temos esse dado.") e o motivo. Nunca zero. */
export function Sem({ status, motivo }: { status?: CoverageStatus | null; motivo?: ReactNode }) {
  return (
    <div className="sv-bloco">
      <Lacuna motivo={motivo}>{(status && fraseCobertura(status)) || SEM_DADO}</Lacuna>
    </div>
  );
}

/** Leitura que falhou: a fonte não respondeu. Não é "o dado não existe". */
export function Falha() {
  return (
    <div className="sv-bloco">
      <Lacuna motivo="Isso não quer dizer que o dado não exista. Tente de novo mais tarde.">Não conseguimos ler esta fonte agora.</Lacuna>
    </div>
  );
}

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

/* ---------- 1. presença: a grade vem de presenca.tsx; aqui só as frases ---------- */

export function frasesPresenca(g: { year: number; present: number; absent: number; justified: number; total: number }): { r: string; t: string } {
  if (g.total === 0) return { r: `Nenhuma sessão de ${g.year} entra na conta.`, t: "Nesse período a pessoa estava fora do exercício do mandato." };
  const faltas = g.absent + g.justified;
  return {
    r: `Esteve em ${fmtInt(g.present)} das ${fmtInt(g.total)} sessões de votação de ${g.year}.`,
    t: faltas > 0 ? `Faltou a ${fmtInt(faltas)} ${plural(faltas, "sessão", "sessões")}: ${fmtInt(g.justified)} com justificativa e ${fmtInt(g.absent)} sem.` : "Não faltou a nenhuma sessão que entra na conta.",
  };
}

/* ---------- 2. gastos do gabinete ---------- */

export type VmGastos = { ano: number; linhas: { label: string; cents: number; pct: number }[]; total: number };

/** Categorias em ordem alfabética (nunca por valor). A barra é proporcional ao maior valor e só apoia a leitura. */
export function vmGastos(byCategory: { label: string; cents: number }[] | undefined, ano: number): VmGastos | null {
  if (!byCategory || byCategory.length === 0) return null;
  const ord = [...byCategory].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  const maior = Math.max(...ord.map((c) => Math.max(0, c.cents)));
  return { ano, total: ord.reduce((s, c) => s + c.cents, 0), linhas: ord.map((c) => ({ label: c.label, cents: c.cents, pct: maior > 0 ? Math.max(0, c.cents) / maior : 0 })) };
}

export function TabelaGastos({ vm }: { vm: VmGastos }) {
  return (
    <table className="sv-g">
      <caption className="sv-vh">Gastos do gabinete em {vm.ano}, por categoria em ordem alfabética</caption>
      <thead className="sv-vh">
        <tr>
          <th scope="col">Categoria</th>
          <th scope="col">Valor</th>
          <th scope="col">Barra de apoio</th>
        </tr>
      </thead>
      <tbody>
        {vm.linhas.map((l) => (
          <tr key={l.label}>
            <th scope="row">{l.label}</th>
            <td>{brl(l.cents)}</td>
            <td className="sv-g__b" aria-hidden="true">
              <i style={{ width: `${(l.pct * 100).toFixed(1)}%` }} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td>{brl(vm.total)}</td>
          <td className="sv-g__b" aria-hidden="true" />
        </tr>
      </tfoot>
    </table>
  );
}

/* ---------- 3. patrimônio declarado ---------- */

export type VmPatrimonio = { linhas: { ano: number; cents: number | null }[] };

/** Uma declaração por eleição, em ordem cronológica. `null` por eleição = a fonte não publicou: lacuna dessa eleição. */
export function vmPatrimonio(cands: Candidacy[] | undefined): VmPatrimonio | null {
  if (!cands) return null;
  const porAno = new Map<number, number | null>();
  for (const c of cands) if (!porAno.has(c.year) || (porAno.get(c.year) === null && c.assetsCents !== null)) porAno.set(c.year, c.assetsCents);
  const linhas = [...porAno].map(([ano, cents]) => ({ ano, cents })).sort((a, b) => a.ano - b.ano);
  return linhas.some((l) => l.cents !== null) ? { linhas } : null;
}

export function fraseMudou(vm: VmPatrimonio): string {
  const ok = vm.linhas.filter((l): l is { ano: number; cents: number } => l.cents !== null);
  if (ok.length < 2) return `Declarou ${brlCurto(ok[0].cents)} em ${ok[0].ano}. Só há uma declaração: não dá para comparar.`;
  const decl = ok.map((l) => `${brlCurto(l.cents)} em ${l.ano}`);
  const mudou = ok.some((l) => l.cents !== ok[0].cents);
  return `${mudou ? "Mudou" : "Não mudou"}. Declarou ${listaE(decl)}.`;
}

export function Declaracoes({ vm }: { vm: VmPatrimonio }) {
  return (
    <div className="sv-decl">
      {vm.linhas.map((l, i) => {
        const ant = i > 0 ? vm.linhas[i - 1] : null;
        const dif = ant && ant.cents !== null && l.cents !== null ? l.cents - ant.cents : null;
        return (
          <div className="sv-decl__g" key={l.ano}>
            {i > 0 && (
              <p className="sv-decl__d">
                {dif === null ? "Sem como comparar: falta um dos valores" : dif === 0 ? "Sem mudança" : `${brlCurto(Math.abs(dif))} ${dif > 0 ? "a mais" : "a menos"}`}
              </p>
            )}
            <div className="sv-decl__c">
              <span className="sv-decl__a">Eleição de {l.ano}</span>
              {l.cents === null ? (
                <Lacuna>A fonte não publicou o valor desta declaração.</Lacuna>
              ) : (
                <span className="sv-decl__v">{brl(l.cents)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- 4. votos ---------- */

export function ListaVotos({ itens }: { itens: PersonVote[] }) {
  return (
    <ul className="sv-votos">
      {itens.map((v) => (
        <li key={v.event.id}>
          <p className="sv-votos__v">
            <VotoMarca voto={v.value} />
          </p>
          <p className="sv-t">
            {v.value === "nao_votou" && <b>Não é voto contra. </b>}
            <Link href={`/v2/votacao/${v.event.id}`}>{clip(v.event.description, 110)}</Link>
          </p>
          <p className="sv-votos__q">{fmtDate(v.event.occurredAt)}</p>
        </li>
      ))}
    </ul>
  );
}

/* ---------- 8. emendas ---------- */

export type VmEmendas = {
  ano: number;
  uf: string | null;
  ufNome: string | null;
  naUf: number;
  fora: number;
  pago: number | null;
  empenhado: number | null;
  pagoNulos: number;
};

/** Soma só o que a fonte publicou (null não vira 0). Mais recente ano com emenda; destino na UF casado pelo município. Nunca por valor. */
export function vmEmendas(lista: Amendment[] | undefined, uf: string | null, ufNome: string | null): VmEmendas | null {
  if (!lista || lista.length === 0) return null;
  const ano = Math.max(...lista.map((a) => a.year));
  const doAno = lista.filter((a) => a.year === ano);
  const naUf = uf ? doAno.filter((a) => a.place?.uf === uf) : doAno;
  const soma = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null);
  return {
    ano,
    uf,
    ufNome,
    naUf: naUf.length,
    fora: doAno.length - naUf.length,
    pago: soma(naUf.map((a) => a.paidCents)),
    empenhado: soma(naUf.map((a) => a.committedCents)),
    pagoNulos: naUf.filter((a) => a.paidCents === null).length,
  };
}

export function RespostaEmendas({ vm }: { vm: VmEmendas }) {
  const onde = vm.ufNome ? `para ${vm.ufNome}` : "";
  return (
    <div className="sv-bloco">
      {vm.naUf === 0 ? (
        <Resposta tamanho="m">
          Nenhuma emenda de {vm.ano} tem destino identificado {vm.ufNome ? `em ${vm.ufNome}` : "nesta leitura"}.
        </Resposta>
      ) : (
        <Resposta tamanho="m">
          {vm.pago !== null ? `${brlCurto(vm.pago)} pagos` : "Valor pago não publicado"}
          {vm.empenhado !== null ? `, de ${brlCurto(vm.empenhado)} empenhados` : ""} em emendas {onde}, em {vm.ano}.
        </Resposta>
      )}
      <p className="sv-t">Empenhado é o valor reservado no orçamento. Pago é o que já saiu do caixa.</p>
      {vm.pagoNulos > 0 && vm.naUf > 0 && (
        <p className="sv-t">
          Em {vm.pagoNulos} {plural(vm.pagoNulos, "emenda", "emendas")} a fonte não publicou o valor pago.
        </p>
      )}
      {vm.fora > 0 && (
        <p className="sv-t">
          Outras {vm.fora} {plural(vm.fora, "emenda", "emendas")} do mesmo ano {plural(vm.fora, "tem", "têm")} destino fora {vm.ufNome ? `de ${vm.ufNome}` : "da UF"} ou sem município identificado.
        </p>
      )}
    </div>
  );
}

/* ---------- 9. campanha ---------- */

export type VmCampanha = { ano: number; total: number; origemCarregada: boolean; publico: number; fundos: string[]; origens: { label: string; cents: number }[] };

/** Nunca nome de doador pessoa física: só o total e a composição por origem (ordem fixa do catálogo). */
export function vmCampanha(lista: CampaignFinance[] | undefined): VmCampanha | null {
  const c = lista?.[0];
  if (!c) return null;
  const origens = CAMPAIGN_ORIGINS.flatMap((o) => {
    const x = c.origins.find((y) => y.origin === o.origin);
    return x ? [{ label: o.label, cents: x.cents, publico: o.publicMoney }] : [];
  });
  const origemCarregada = origens.length > 0;
  const total = origemCarregada ? origens.reduce((s, o) => s + o.cents, 0) : c.income.reduce((s, i) => s + i.cents, 0);
  if (!origemCarregada && c.income.length === 0) return null;
  const publicas = origens.filter((o) => o.publico);
  return { ano: c.year, total, origemCarregada, publico: publicas.reduce((s, o) => s + o.cents, 0), fundos: publicas.filter((o) => o.cents > 0).map((o) => o.label), origens: origens.map(({ label, cents }) => ({ label, cents })) };
}

/* ---------- 10. comissões ---------- */

/** Só as comissões de hoje (sem data de saída ou saída futura), em ordem alfabética do nome. */
export function comissoesAtuais(lista: CommitteeItem[], hoje: string): CommitteeItem[] {
  return lista.filter((c) => !c.to || c.to >= hoje).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/* ---------- 12. mês do mandato ---------- */

export function mesDoMandato(inicio: string, fim: string, hoje: { ano: number; mes: number }): { n: number; m: number; nome: string } | null {
  const i = /^(\d{4})-(\d{2})/.exec(inicio);
  const f = /^(\d{4})-(\d{2})/.exec(fim);
  if (!i || !f) return null;
  const n = (hoje.ano - +i[1]) * 12 + (hoje.mes - +i[2]) + 1;
  // fim no dia 1 (posse do sucessor em 1º de fevereiro): esse mês já não é do mandato
  const fimNoDia1 = /^\d{4}-\d{2}-01/.test(fim);
  const m = (+f[1] - +i[1]) * 12 + (+f[2] - +i[2]) + (fimNoDia1 ? 0 : 1);
  if (m < 1 || n < 1 || n > m) return null;
  return { n, m, nome: `${MESES[hoje.mes - 1][0].toUpperCase()}${MESES[hoje.mes - 1].slice(1)} de ${hoje.ano}` };
}
