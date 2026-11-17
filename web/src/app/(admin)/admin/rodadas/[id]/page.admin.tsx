import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, Navegacao } from "@/components/admin/blocos";
import { PainelVivo, type EstadoApi, type RelatorioSerial, type RodadaSerial } from "@/components/admin/painel-vivo";
import { agregarPais } from "@/lib/admin/agregacao";
import { ErroInvariante, ErroLeituraBanco, ErroNaoEncontrado, estadoDoExecutor, fichas, relatorioDaRodada, rodada } from "@/lib/admin/consultas";
import { contagensDeAgregado, mostrarValor, serializavel } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { abreviarId, descreverRecorte, modoDaRodada, statusDoPedido, tipoDoPedido } from "@/lib/admin/rotulos";
import { dataComRelativo } from "@/lib/admin/tempo";

export const dynamic = "force-dynamic";

export default async function PaginaRodada({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  try {
    const [r, executor, todas] = await Promise.all([rodada(id), estadoDoExecutor(), fichas()]);
    const agora = new Date();
    let relatorio: RelatorioSerial | null = null;
    let parcial = false;
    try {
      relatorio = serializavel((await relatorioDaRodada(id)) as unknown as RelatorioSerial);
    } catch (e) {
      if (!(e instanceof ErroInvariante)) throw e;
      parcial = true;
    }
    const cabecalho: RodadaSerial = serializavel({ id: r.id, coletor: r.coletor, modo: r.modo, status: r.status, iniciada_em: r.iniciada_em as string | null, finalizada_em: r.finalizada_em as string | null, repete_id: r.repete_id });
    const inicial = serializavel({ ...executor, mapa: contagensDeAgregado(agregarPais(todas)) }) as unknown as EstadoApi;
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin/rodadas" />
        <h1>Rodada {r.coletor}</h1>
        <p>
          <Link href="/admin/rodadas" className="chip">
            Todas as rodadas
          </Link>
        </p>
        <p className="adm-ajuda">
          {modoDaRodada(String(r.modo))}. Recorte: {descreverRecorte(r.recorte)}.{r.repete_id ? ` Repete outra rodada (${abreviarId(String(r.repete_id))}).` : ""} Iniciada em {dataComRelativo(r.iniciada_em, agora)}.
        </p>
        {parcial && <p className="adm-marca">Os totais desta rodada ainda não fecham (rodada em andamento). Eles aparecem assim que fecharem.</p>}
        <PainelVivo inicial={inicial} rodada={cabecalho} relatorio={relatorio} mostrarPaineis />
        <section className="adm-bloco" aria-labelledby="adm-ped-t">
          <h2 id="adm-ped-t">Pedidos ligados a esta rodada</h2>
          {r.pedidos.length === 0 && <p>Nenhum pedido ligado.</p>}
          {r.pedidos.length > 0 && (
            <div className="adm-rolagem" tabIndex={0} role="region" aria-label="Pedidos da rodada (role para o lado em tela pequena)">
              <table className="adm-tabela">
                <caption className="adm-sr">Pedidos ligados a esta rodada</caption>
                <thead>
                  <tr>
                    <th scope="col">Pedido</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Criado</th>
                    <th scope="col">Andamento ou erro</th>
                  </tr>
                </thead>
                <tbody>
                  {(r.pedidos as Record<string, unknown>[]).map((p) => (
                    <tr key={String(p.id)}>
                      <th scope="row">{tipoDoPedido(String(p.tipo))}</th>
                      <td>{statusDoPedido(String(p.status))}</td>
                      <td>{dataComRelativo(p.criado_em, agora)}</td>
                      <td>
                        {p.andamento != null ? `Andamento: ${mostrarValor(p.andamento)}. ` : ""}
                        {p.erro ? `Erro: ${String(p.erro)}.` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    );
  } catch (e) {
    if (e instanceof ErroNaoEncontrado) notFound();
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin/rodadas" />
          <h1>Rodada</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
