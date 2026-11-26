import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import "@/styles/sv-mandato.css";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { fmtInt } from "@/components/sv/fmt";
import { ESFERA } from "@/components/sv/pessoa/cargos";
import { PessoaNaoLida } from "@/components/sv/pessoa/falha";
import { carregarPessoa, contextoPessoa, lerPessoa } from "@/components/sv/pessoa/contexto";
import { brl } from "@/components/sv/pessoa/format";
import { carregarMandato } from "@/components/sv/pessoa/mandato-dados";
import { BlocoCusto, BlocoFora, mesLongo, Traco } from "@/components/sv/pessoa/mandato-blocos";
import { Falha, Linha, LacunaBloco } from "@/components/sv/pessoa/secoes";
import { CabecalhoSub } from "@/components/sv/pessoa/sub";
import { Nota, Selo } from "@/components/sv/ui";
import { frasePeriodo } from "@/lib/mandato-visao";

// Visão do mandato: o gasto da cota por categoria (A–Z) e por mês (cronológico), na janela que a tela diz em palavras.
// Nunca ordena por valor, nunca calcula média nem compara com outras pessoas. Nota a nota fica em /gastos.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await carregarPessoa((await params).slug).catch(() => undefined);
  return { title: r ? `Mandato · ${r.person.displayName}` : r === undefined ? "Não conseguimos ler agora" : "Pessoa não encontrada" };
}

export default async function MandatoPessoa({ params, searchParams }: Props) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await lerPessoa(slug, sp.simular);
  if (r === undefined) return <PessoaNaoLida />;
  if (!r) notFound();
  if (r.redirectTo) permanentRedirect(`/pessoa/${r.redirectTo}/mandato`);
  const ctx = await contextoPessoa(r.person);
  const d = await carregarMandato(ctx).catch(() => null);
  const forma = ctx.main ? ESFERA[ctx.main.office] : null;
  const vm = d?.gasto.vm ?? null;
  const janela = d?.janela ?? null;
  const periodo = janela ? frasePeriodo(janela.desdeAno, janela) : "";
  const base = `/pessoa/${ctx.person.slug}`;

  return (
    <div className="sv-pg sv-pg--pessoa">
      <CabecalhoSub ctx={ctx} titulo={`O mandato de ${ctx.person.displayName}`} esfera={forma} />
      {!d ? (
        <Falha />
      ) : (
        <>
          <Linha id="m1" numero={1} pergunta="Quanto custou o mandato?" fonte={d.gasto.fonte || d.fonteMandato}>
            <BlocoCusto d={d} />
          </Linha>

          <Linha id="m2" numero={2} pergunta="Em que categorias foi gasto o dinheiro?" fonte={d.gasto.fonte}>
            {vm ? (
              <div className="sv-bloco">
                <table className="sv-gm" data-testid="tabela-categorias-mandato">
                  <caption className="sv-vh">Gasto por categoria, {periodo}, em ordem alfabética</caption>
                  <thead className="sv-vh">
                    <tr>
                      <th scope="col">Categoria</th>
                      <th scope="col">Valor</th>
                      <th scope="col">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.categorias.map((c) => (
                      <tr key={c.label}>
                        <th scope="row">{c.label}</th>
                        <td>{brl(c.cents)}</td>
                        <td className="sv-gm__n">{fmtInt(c.notas)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Soma das notas</th>
                      <td>{brl(vm.totalCents)}</td>
                      <td className="sv-gm__n">{fmtInt(vm.notas)}</td>
                    </tr>
                  </tfoot>
                </table>
                <Nota>
                  <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo> Categorias em ordem alfabética, {periodo}.
                  {vm.temEstorno ? " Valor negativo é estorno publicado pela fonte." : ""}
                </Nota>
                <p className="sv-selo__l">
                  <Link href={`${base}/gastos`}>Ver nota por nota</Link>
                </p>
              </div>
            ) : (
              d.gasto.lacuna && <LacunaBloco vm={d.gasto.lacuna} />
            )}
          </Linha>

          <Linha id="m3" numero={3} pergunta="E mês a mês?" fonte={d.gasto.fonte}>
            {vm ? (
              <div className="sv-bloco">
                <table className="sv-gm" data-testid="tabela-meses-mandato">
                  <caption className="sv-vh">Gasto por mês, {periodo}, em ordem cronológica</caption>
                  <thead className="sv-vh">
                    <tr>
                      <th scope="col">Mês</th>
                      <th scope="col">Valor</th>
                      <th scope="col">Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.meses.map((m) => (
                      <tr key={m.mes} data-mes={m.mes}>
                        <th scope="row">{mesLongo(m.mes)}</th>
                        <td>{m.cents === null ? <Traco /> : brl(m.cents)}</td>
                        <td className="sv-gm__n">{m.cents === null ? "sem nota" : fmtInt(m.notas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Nota>Em ordem cronológica. “—” é mês sem nota na fonte, entre o primeiro e o último com nota: não quer dizer que nada foi gasto.</Nota>
              </div>
            ) : (
              d.gasto.lacuna && <LacunaBloco vm={d.gasto.lacuna} />
            )}
          </Linha>

          <Linha id="m4" numero={4} pergunta="O que ficou de fora?" fonte={`Leitura das fontes: ${d.lidoEm ? new Date(d.lidoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "data não registrada"}.`}>
            <BlocoFora d={d} />
          </Linha>
        </>
      )}
      <Selo lidoEm={d?.lidoEm ?? null} />
    </div>
  );
}
