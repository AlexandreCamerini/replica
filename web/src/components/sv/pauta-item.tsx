import Link from "next/link";
import type { PautaEntry } from "@/lib/data";
import { deciders, isUrgent, ofBody, reasonText, typeName } from "@/lib/pauta";
import { AFIRMACAO } from "./estados";
import { BODY_NAME, billLabel, clip, fmtWeekday } from "./fmt";
import { Etiqueta, JaVale, JaValeLegenda, Nota, Resposta } from "./ui";
import { vigenciaDe } from "./vigencia";

// Um item da pauta numa lista (Decisões): esfera em palavra, o que propõe (link para a Decisão), quando e onde, quem decide,
// "Já vale?" pelo tipo e o motivo de estar aqui. Mesma composição dos itens de Temas. `legenda` mostra a legenda de "Já vale?".

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function quandoOnde(e: PautaEntry): string {
  const onde = e.stage === "comissao" ? `em comissão ${ofBody(e.body)}${e.committee ? `, ${e.committee}` : ""}` : `no plenário ${ofBody(e.body)}`;
  return `${cap(fmtWeekday(e.scheduledFor))}, ${onde}${isUrgent(e.regime) ? ", em regime de urgência" : ""}.`;
}

export function PautaItem({ e, legenda = false, quando }: { e: PautaEntry; legenda?: boolean; /** linha de quando/onde própria (ex.: "Saiu da pauta em …") */ quando?: string }) {
  const d = deciders(e);
  const v = vigenciaDe(e.type);
  return (
    <li className="sv-pi">
      <p className="sv-esf">Esfera: Federal · {BODY_NAME[e.body]}</p>
      <Resposta tamanho="m">
        <Link href={`/decisao/${e.key}`}>
          {e.plain ?? clip(e.summary ?? "Resumo não publicado pela fonte", 150)} <span aria-hidden="true">→</span>
        </Link>
      </Resposta>
      <p className="sv-t">
        {quando ?? quandoOnde(e)} Quem decide: {low(d.who)} {d.needs}
      </p>
      <p className="sv-vale-l">
        Já vale? <JaVale estado={v.estado} frase={v.frase} />
      </p>
      {legenda && <JaValeLegenda />}
      {!e.reviewedAt && (
        <p className="sv-t">
          <Etiqueta>{AFIRMACAO.aguardando}</Etiqueta> A explicação em linguagem simples ainda não foi conferida; o resumo é o da fonte.
        </p>
      )}
      <Nota>
        {billLabel(e)} ({typeName(e.type)}). {reasonText(e)}
      </Nota>
    </li>
  );
}
