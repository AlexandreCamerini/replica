import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, Navegacao } from "@/components/admin/blocos";
import { PainelVivo, type EstadoApi, type RelatorioSerial, type RodadaSerial } from "@/components/admin/painel-vivo";
import { agregarPais } from "@/lib/admin/agregacao";
import { ErroInvariante, ErroLeituraBanco, ErroNaoEncontrado, estadoDoExecutor, fichas, relatorioDaRodada, rodada } from "@/lib/admin/consultas";
import { contagensDeAgregado, mostrarValor, serializavel, textoData } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";

export const dynamic = "force-dynamic";

export default async function PaginaRodada({ params }: { params: Promise<{ id: string }> }) {
  exigirAdmin();
  const { id } = await params;
  try {
    const [r, executor, todas] = await Promise.all([rodada(id), estadoDoExecutor(), fichas()]);
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
          <Link href="/admin/rodadas">Todas as rodadas</Link>
        </p>
        <p className="adm-ajuda">
          Recorte: {mostrarValor(r.recorte)}.{r.repete_id ? ` Repete a rodada ${r.repete_id}.` : ""} Iniciada em {textoData(r.iniciada_em)}.
        </p>
        {parcial && <p className="adm-marca">Os totais desta rodada ainda não fecham (rodada em andamento). Eles aparecem assim que fecharem.</p>}
        <PainelVivo inicial={inicial} rodada={cabecalho} relatorio={relatorio} mostrarPaineis />
        <section className="adm-bloco" aria-labelledby="adm-ped-t">
          <h2 id="adm-ped-t">Pedidos ligados a esta rodada</h2>
          {r.pedidos.length === 0 && <p>Nenhum pedido ligado.</p>}
          <ul className="adm-lista">
            {(r.pedidos as Record<string, unknown>[]).map((p) => (
              <li key={String(p.id)} className="adm-item">
                {String(p.tipo)}: {String(p.status)}, criado em {textoData(p.criado_em)}. {p.andamento != null ? `Andamento: ${mostrarValor(p.andamento)}.` : ""} {p.erro ? `Erro: ${String(p.erro)}.` : ""}
              </li>
            ))}
          </ul>
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
