import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { ExemploIlustrativo } from "@/components/sv/etiqueta";
import { fmtDate, fmtInt } from "@/components/sv/fmt";
import { SEM_DADO } from "@/components/sv/estados";
import { ESFERA } from "@/components/sv/pessoa/cargos";
import { PessoaNaoLida } from "@/components/sv/pessoa/falha";
import { carregarPessoa, contextoPessoa, lerPessoa } from "@/components/sv/pessoa/contexto";
import { vmEquipe } from "@/components/sv/pessoa/equipe";
import { brl, ler } from "@/components/sv/pessoa/format";
import { Falha, Linha, Sem, SemCobertura } from "@/components/sv/pessoa/secoes";
import { CabecalhoSub } from "@/components/sv/pessoa/sub";
import { Lacuna, Nota, Resposta, Selo } from "@/components/sv/ui";
import { data } from "@/lib/data";

// Equipe do gabinete SÓ em agregado: quantos, por função (como a fonte escreve) e quanto, com fonte e data. Nenhum nome de
// assessor (catálogo de 08/11, "Não adaptar": terceiro, pessoa física; LGPD). O perfil v1 lista nomes; o /v2 não.

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ simular?: string | string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await carregarPessoa((await params).slug).catch(() => undefined);
  return { title: r ? `Equipe do gabinete · ${r.person.displayName}` : r === undefined ? "Não conseguimos ler agora" : "Pessoa não encontrada" };
}

export default async function EquipePessoa({ params, searchParams }: Props) {
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  // null = não existe (404); undefined = a leitura falhou (lacuna, nunca 500)
  const r = await lerPessoa(slug, sp.simular);
  if (r === undefined) return <PessoaNaoLida />;
  if (!r) notFound();
  if (r.redirectTo) permanentRedirect(`/v2/pessoa/${r.redirectTo}/equipe`);
  const ctx = await contextoPessoa(r.person);
  const [staff, sEquipe, refresh] = await Promise.all([ler(data.listStaff(ctx.person.id)), ctx.stampDe(ctx.body === "camara" ? "camara.equipe" : null), ler(data.latestRefresh())]);
  // a lista carregada é o agregado; daqui para baixo nenhum nome é lido
  const vm = staff.ok ? vmEquipe(staff.v) : null;
  const esfera = ctx.main ? ESFERA[ctx.main.office] : null;
  const fonte = ctx.fonteConjunto("equipe", "pessoal do gabinete", sEquipe, !!vm);

  return (
    <div className="sv-pg sv-pg--pessoa">
      <CabecalhoSub ctx={ctx} titulo={`Equipe do gabinete de ${ctx.person.displayName}`} esfera={esfera} />

      <Linha id="e1" numero={1} pergunta="Quantas pessoas trabalham no gabinete?" fonte={fonte}>
        {vm ? (
          <div className="sv-bloco">
            <Resposta tamanho="r">
              {fmtInt(vm.total)} {vm.total === 1 ? "pessoa" : "pessoas"}
              {vm.dataLista ? ` na lista de ${fmtDate(vm.dataLista)}` : ""}.
            </Resposta>
            {!vm.dataLista && <p className="sv-t">A fonte não registra a data da lista.</p>}
            <p>
              <ExemploIlustrativo>Exemplo ilustrativo: pessoa e valores fictícios</ExemploIlustrativo>
            </p>
          </div>
        ) : ctx.posse ? (
          <Sem motivo={ctx.posse} />
        ) : !staff.ok ? (
          <Falha />
        ) : (
          <SemCobertura cob={ctx.cob("equipe")} oQue="pessoa na equipe do gabinete" />
        )}
      </Linha>

      {vm && (
        <Linha id="e2" numero={2} pergunta="Em que funções?" fonte={fonte}>
          <div className="sv-bloco">
            <table className="sv-g sv-g--s">
              <caption className="sv-vh">Pessoas por função no gabinete, funções em ordem alfabética</caption>
              <thead className="sv-vh">
                <tr>
                  <th scope="col">Função</th>
                  <th scope="col">Pessoas</th>
                </tr>
              </thead>
              <tbody>
                {vm.funcoes.map((f) => (
                  <tr key={f.funcao}>
                    <th scope="row">{f.funcao}</th>
                    <td>{fmtInt(f.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Nota>Funções como a fonte escreve, em ordem alfabética.</Nota>
          </div>
        </Linha>
      )}

      {vm && (
        <Linha id="e3" numero={3} pergunta="Quanto custa por mês?" fonte={fonte}>
          <div className="sv-bloco">
            {vm.somaMensal !== null ? (
              <>
                <Resposta tamanho="m">{brl(vm.somaMensal)} por mês, somando os salários publicados.</Resposta>
                {vm.semSalario > 0 && (
                  <p className="sv-t">
                    A soma deixa de fora {fmtInt(vm.semSalario)} {vm.semSalario === 1 ? "pessoa" : "pessoas"} sem salário publicado na fonte.
                  </p>
                )}
              </>
            ) : (
              <Lacuna motivo="A lista lida não traz remuneração. A folha de pagamento é outra fonte, que ainda não carregamos.">{SEM_DADO}</Lacuna>
            )}
          </div>
        </Linha>
      )}

      <section className="sv-l3" aria-labelledby="e4">
        <h2 className="sv-p" id="e4">
          Por que não aparecem os nomes?
        </h2>
        <div className="sv-bloco">
          <p className="sv-t">Quem trabalha no gabinete é terceiro ao mandato, pessoa física. Por isso mostramos só quantos são, em que funções e quanto custam, nunca o nome de cada um.</p>
        </div>
        <p className="sv-fonte">Regra do Segue o Voto para dado pessoal de terceiros (Lei Geral de Proteção de Dados).</p>
      </section>

      <Selo lidoEm={refresh.ok ? refresh.v : null} />
    </div>
  );
}
