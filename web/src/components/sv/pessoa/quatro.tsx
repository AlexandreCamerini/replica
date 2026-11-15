// Quadro do topo da Pessoa (D324): quatro respostas, sempre nesta ordem, antes das seções. Server component, sem JS.
// Nada é calculado aqui: cada resposta é o dado que a seção correspondente já mostra, com a mesma fonte e, sem dado, a
// mesma lacuna nomeada (decidida uma vez na página). Sem nota, sem média, sem comparação com outras pessoas.
import type { ReactNode } from "react";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { Lacuna } from "@/components/sv/ui";
import type { LacunaVm } from "./secoes";

export type RespostaRapida = {
  pergunta: string;
  /** id da seção da página que detalha a resposta */
  ancora: string;
  /** texto do link para a seção */
  ir: string;
  /** o dado, quando há; null = `lacuna` */
  resposta: ReactNode | null;
  /** frase menor abaixo da resposta */
  apoio?: ReactNode;
  lacuna: LacunaVm | null;
  fonte: ReactNode;
};

/**
 * Lista de definição: a pergunta é o termo e a resposta, a fonte e o link são as descrições. Não usa título (h3) para a
 * pergunta, porque cada pergunta já é o h2 da própria seção, mais abaixo. A lacuna sai sem `data-cobertura`: o estado de
 * cobertura fica marcado uma vez só, na seção.
 */
export function QuatroRespostas({ itens }: { itens: RespostaRapida[] }) {
  return (
    <section className="sv-q4" aria-labelledby="p-q4">
      <h2 className="sv-p" id="p-q4">
        Quatro respostas rápidas <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo>
      </h2>
      <dl className="sv-q4__l">
        {itens.map((i) => (
          <div className="sv-q4__i" key={i.ancora}>
            <dt>{i.pergunta}</dt>
            <dd className="sv-q4__a">
              {i.lacuna ? (
                <Lacuna motivo={i.lacuna.motivo}>{i.lacuna.texto}</Lacuna>
              ) : (
                <>
                  {i.resposta}
                  {i.apoio && <span className="sv-q4__s">{i.apoio}</span>}
                </>
              )}
            </dd>
            <dd className="sv-fonte">{i.fonte}</dd>
            <dd className="sv-q4__ir">
              <a href={`#${i.ancora}`}>
                {i.ir}
                <span aria-hidden="true">&nbsp;↓</span>
              </a>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
