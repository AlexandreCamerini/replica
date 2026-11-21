// Painel do mandato no topo da Pessoa: quatro blocos curtos, cada um uma pergunta de eleitor. Server component, sem JS.
import Link from "next/link";
import "@/styles/sv-mandato.css";
import { fraseDesde } from "@/components/sv/mandato";
import { Fonte, Lacuna, Pergunta } from "@/components/sv/ui";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { ESFERA } from "./cargos";
import { BlocoCusto, BlocoFez, BlocoFora } from "./mandato-blocos";
import type { DadosMandato } from "./mandato-dados";

export function PainelMandato({ d }: { d: DadosMandato }) {
  const { ctx } = d;
  const main = ctx.main;
  const partido = main ? (main.party.name && main.party.name !== main.party.acronym ? `${main.party.acronym} (${main.party.name})` : main.party.acronym) : null;
  return (
    <div className="sv-pm" data-testid="painel-mandato">
      <section className="sv-pm__b" aria-labelledby="pm-1">
        <Pergunta id="pm-1">Qual é o mandato?</Pergunta>
        {main ? (
          <div className="sv-bloco">
            <p className="sv-a sv-a--m">
              {main.officeName}
              {ctx.ufSigla ? ` por ${ctx.ufSigla}` : main.placeLabel ? ` em ${main.placeLabel}` : ""}.
            </p>
            <p className="sv-t">{[partido, fraseDesde(main, ctx.fem)].filter(Boolean).join(" · ")}.</p>
            <p className="sv-nota">{ESFERA[main.office]}</p>
            <Fonte>Fonte: {d.fonteMandato}.</Fonte>
            {d.aplica && (
              <p className="sv-pm__ir">
                <Link href={`/pessoa/${ctx.person.slug}/mandato`}>Ver o gasto do mandato, categoria por categoria e mês a mês</Link>
              </p>
            )}
            <p>
              <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo>
            </p>
          </div>
        ) : (
          <div className="sv-bloco">
            <Lacuna>Não consta mandato carregado para esta pessoa.</Lacuna>
          </div>
        )}
      </section>
      <section className="sv-pm__b" aria-labelledby="pm-2">
        <Pergunta id="pm-2">Quanto custou?</Pergunta>
        <BlocoCusto d={d} />
      </section>
      <section className="sv-pm__b" aria-labelledby="pm-3">
        <Pergunta id="pm-3">O que fez?</Pergunta>
        <BlocoFez d={d} />
      </section>
      <section className="sv-pm__b" aria-labelledby="pm-4">
        <Pergunta id="pm-4">O que ficou de fora?</Pergunta>
        <BlocoFora d={d} />
      </section>
    </div>
  );
}
