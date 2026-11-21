// Blocos da visão do mandato, usados no painel da Pessoa e na página /pessoa/[slug]/mandato. Server components, sem JS.
// Cada bloco responde uma pergunta de eleitor. Sem dado: "—" (nunca 0) e o motivo. Sem ordenação por valor, sem média,
// sem comparação com outras pessoas, sem proporção. Cor: nenhuma (tinta sobre papel).
import type { ReactNode } from "react";
import { fmtInt } from "@/components/sv/fmt";
import { Fonte, Lacuna, Nota } from "@/components/sv/ui";
import { frasePeriodo } from "@/lib/mandato-visao";
import { brl, MESES } from "./format";
import type { DadosMandato, ItemMandato } from "./mandato-dados";

/** "—" lido como "sem dado" por leitor de tela. */
export function Traco() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sv-vh">sem dado</span>
    </>
  );
}

/** "janeiro de 2024" de "2024-01". */
export function mesLongo(mes: string): string {
  const [a, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m} de ${a}`;
}

/** Quanto custou: salário + cota, só somando quando os dois existem, com o que ficou de fora. */
export function BlocoCusto({ d }: { d: DadosMandato }) {
  if (!d.aplica || !d.custo || !d.janela) {
    return (
      <div className="sv-bloco">
        <Lacuna motivo={d.motivoNaoAplica ?? undefined}>{d.motivoNaoAplica ? "Sem custo para mostrar." : "Ainda não temos esse dado."}</Lacuna>
      </div>
    );
  }
  const { custo, janela } = d;
  const periodo = frasePeriodo(janela.desdeAno, janela);
  const cotaTxt = d.gasto.vm ? brl(d.gasto.vm.totalCents) : null;
  const salTxt = d.salario.v ? brl(d.salario.v.cents) : null;
  return (
    <div className="sv-bloco" data-testid="bloco-custo">
      {custo.estado === "soma" ? (
        <>
          <p className="sv-a sv-a--m">{brl(custo.totalCents)} de salário e cota.</p>
          <p className="sv-t">Soma do que está carregado, {periodo}.</p>
        </>
      ) : (
        <>
          <Lacuna motivo={`Não somamos: ${custo.faltam.length > 1 ? "faltam" : "falta"} ${custo.faltam.join(" e ")}. Uma soma com uma parte só pareceria o custo inteiro.`}>Sem soma de salário e cota.</Lacuna>
        </>
      )}
      <dl className="sv-pm__l">
        <div>
          <dt>Salário, bruto</dt>
          <dd>{salTxt ?? <Traco />}</dd>
        </div>
        <div>
          <dt>{d.rotulo === "cota parlamentar" ? "Cota parlamentar" : "Gastos do gabinete"}</dt>
          <dd>{cotaTxt ?? <Traco />}</dd>
        </div>
      </dl>
      {d.salario.lacuna && <Nota>Salário: {d.salario.lacuna.texto}</Nota>}
      {d.gasto.lacuna && <Nota>Cota: {d.gasto.lacuna.texto}</Nota>}
      {custo.fora.length > 0 && (
        <div className="sv-pm__fora">
          <p className="sv-nota">
            <b>Ficou fora da soma:</b>
          </p>
          <ul className="sv-nota">
            {custo.fora.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <Nota>Valores como a fonte publica, na data da leitura abaixo. Estorno (valor negativo) entra na conta. A fonte pode corrigir lançamentos depois: o número pode mudar numa próxima leitura.</Nota>
      <Fonte>{d.gasto.fonte}</Fonte>
      <Fonte>{d.salario.fonte}</Fonte>
    </div>
  );
}

function LinhaFez({ rotulo, it, children }: { rotulo: string; it: ItemMandato; children?: ReactNode }) {
  return (
    <div className="sv-pm__r">
      <dt>{rotulo}</dt>
      <dd>
        {it.texto ? (
          <>
            <b>{it.texto}</b>
            {it.periodo && <span className="sv-sm">{it.periodo}</span>}
            {children}
          </>
        ) : (
          <>
            <Traco />
            {it.lacuna && (
              <span className="sv-sm">
                {it.lacuna.texto}
                {typeof it.lacuna.motivo === "string" && it.lacuna.motivo ? ` · ${it.lacuna.motivo}` : ""}
              </span>
            )}
          </>
        )}
      </dd>
    </div>
  );
}

/** O que fez: votos, propostas, comissões, discursos e presença. Cada número diz desde quando. */
export function BlocoFez({ d }: { d: DadosMandato }) {
  if (!d.aplica) {
    return (
      <div className="sv-bloco">
        <Lacuna motivo={d.motivoNaoAplica ?? undefined}>Sem registro de atuação para mostrar.</Lacuna>
      </div>
    );
  }
  const { votos, propostas, comissoes, discursos, presenca } = d.fez;
  return (
    <div className="sv-bloco" data-testid="bloco-fez">
      <dl className="sv-pm__l sv-pm__l--fez">
        <LinhaFez rotulo="Votos" it={votos} />
        <LinhaFez rotulo="Propostas" it={propostas} />
        <LinhaFez rotulo="Comissões" it={comissoes}>
          {comissoes.lista && comissoes.lista.length > 0 && (
            <ul className="sv-pm__c">
              {comissoes.lista.slice(0, 5).map((n) => (
                <li key={n}>{n}</li>
              ))}
              {comissoes.lista.length > 5 && <li>e mais {fmtInt(comissoes.lista.length - 5)}, em ordem alfabética</li>}
            </ul>
          )}
        </LinhaFez>
        <LinhaFez rotulo="Discursos" it={discursos} />
        <LinhaFez rotulo="Presença" it={presenca} />
      </dl>
      <Nota>Só o que lemos desta pessoa, sem média nem comparação com outras. Votos, propostas e presença são somados por ano inteiro. Cada número diz desde quando está carregado.</Nota>
      <Fonte>{[votos, propostas, comissoes, discursos, presenca].filter((i) => i.texto).map((i) => i.fonte).filter(Boolean).join(" ") || "Fonte: nenhum dado de atuação carregado para este período."}</Fonte>
    </div>
  );
}

/** O que ficou de fora, com o motivo de cada um. */
export function BlocoFora({ d }: { d: DadosMandato }) {
  return (
    <div className="sv-bloco" data-testid="bloco-fora">
      {d.fora.length === 0 ? (
        <p className="sv-t">Nada faltou nesta leitura.</p>
      ) : (
        <ul className="sv-pm__f">
          {d.fora.map((f) => (
            <li key={`${f.oQue}-${f.motivo}`}>
              <b>{f.oQue}:</b> {f.motivo}
            </li>
          ))}
        </ul>
      )}
      <Nota>“—” quer dizer que a fonte não foi lida ou não publica: não é zero.</Nota>
    </div>
  );
}
