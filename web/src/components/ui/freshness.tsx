import { date } from "@/lib/format";

const KIND = { votacao: "votação", proposta: "proposta", gasto: "gasto" } as const;

/** Mesma linguagem do "Pauta lida em" do cabeçalho (.lbl, mono). */
const cls = "lbl";

const epoch = (iso: string) => new Date(iso).getTime() <= 0 || Number.isNaN(new Date(iso).getTime());
const hasYear = (iso: string) => iso.slice(0, 4) !== String(new Date().getFullYear());
/** DD/MM no horário de Brasília; com o ano quando o registro não é do ano corrente (senão "12/03" seria ambíguo). */
const dm = (iso: string, withYear = false) => (withYear ? date(iso) : date(iso).slice(0, 5));

/**
 * U01. "Conferido com a lista oficial em 08/11 · registro mais recente: votação de 05/11".
 * `checkedAt` vem de dataset_stamps e `record` do fato mais recente da pessoa. Sem os dois, a linha some (nunca "—").
 * Só um dos dois: mostra só ele, sem preencher o outro. `monthOnly`: a fonte só dá o mês do gasto, então mostra MM/AAAA (nunca um dia inventado).
 */
export function FreshnessLine({ checkedAt, record, testId = "conferido" }: { checkedAt?: string | null; record?: { kind: keyof typeof KIND; on: string; monthOnly?: boolean } | null; testId?: string }) {
  const checked = checkedAt && !epoch(checkedAt) ? checkedAt : null;
  if (!checked && !record) return null;
  return (
    <p className={cls} data-testid={testId}>
      {checked && (
        <>
          Conferido com a lista oficial em <time dateTime={checked}>{dm(checked)}</time>
        </>
      )}
      {checked && record && " · "}
      {record && (
        <>
          {checked ? "registro" : "Registro"} mais recente: {KIND[record.kind]} de{" "}
          <time dateTime={record.on}>{record.monthOnly ? date(record.on).slice(3) : dm(record.on, hasYear(record.on))}</time>
        </>
      )}
    </p>
  );
}
