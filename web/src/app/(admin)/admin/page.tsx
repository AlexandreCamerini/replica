import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, BlocoVazio, Navegacao } from "@/components/admin/blocos";
import { PainelVivo, type EstadoApi, type RelatorioSerial, type RodadaSerial } from "@/components/admin/painel-vivo";
import { agregarPais } from "@/lib/admin/agregacao";
import { ErroInvariante, ErroLeituraBanco, ErroNaoEncontrado, estadoDoExecutor, fichas, relatorioDaRodada, rodada, rodadas } from "@/lib/admin/consultas";
import { estadosDoMapa } from "@/lib/admin/mapa-dados";
import { contagensDeAgregado, serializavel, visaoDe } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";

export const dynamic = "force-dynamic";

type Busca = { rodada?: string; visao?: string };

export default async function PaginaInicial({ searchParams }: { searchParams: Promise<Busca> }) {
  exigirAdmin();
  const sp = await searchParams;
  const visao = visaoDe(sp.visao);
  try {
    const [lista, todas, executor] = await Promise.all([rodadas(50), fichas(), estadoDoExecutor()]);
    const id = typeof sp.rodada === "string" && sp.rodada !== "" ? sp.rodada : (lista[0]?.id as string | undefined);
    let cabecalho: RodadaSerial | null = null;
    let relatorio: RelatorioSerial | null = null;
    let totaisParciais = false;
    if (id) {
      const r = await rodada(id);
      cabecalho = serializavel({ id: r.id, coletor: r.coletor, modo: r.modo, status: r.status, iniciada_em: r.iniciada_em as string | null, finalizada_em: r.finalizada_em as string | null, repete_id: r.repete_id });
      try {
        relatorio = serializavel((await relatorioDaRodada(id)) as unknown as RelatorioSerial);
      } catch (e) {
        if (!(e instanceof ErroInvariante)) throw e;
        totaisParciais = true; // rodada em andamento: as somas ainda não fecham
      }
    }
    const ag = agregarPais(todas);
    const estados = await estadosDoMapa(visao, todas, id ?? null, cabecalho?.status ?? null);
    const estadosPorUf: Record<string, string> = {};
    for (const [k, v] of estados) if (k.startsWith("uf:")) estadosPorUf[k.slice(3)] = v;
    const inicial = serializavel({ ...executor, mapa: contagensDeAgregado(ag) }) as unknown as EstadoApi;
    const q = (v: string) => `/admin?visao=${v}${id ? `&rodada=${id}` : ""}`;

    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin" />
        <h1>Central de coleta</h1>
        {lista.length === 0 && <BlocoVazio />}
        <nav aria-label="Visão do mapa" className="adm-visao">
          <Link href={q("coleta")} aria-current={visao === "coleta" ? "page" : undefined}>
            Coleta
          </Link>
          <Link href={q("revisao")} aria-current={visao === "revisao" ? "page" : undefined}>
            Revisão
          </Link>
        </nav>
        {totaisParciais && <p className="adm-marca">Os totais desta rodada ainda não fecham (rodada em andamento). Eles aparecem assim que fecharem.</p>}
        <p className="adm-ajuda">
          Os painéis de coleta e de revisão são separados e nunca somados. Esta tela só grava pedidos; o executor da linha de comando consome.{" "}
          {lista.length > 0 && <Link href="/admin/rodadas">Todas as rodadas</Link>}
        </p>
        <PainelVivo
          inicial={inicial}
          rodada={cabecalho}
          relatorio={relatorio}
          mostrarPaineis
          mapaPais={{ visao, estadosPorUf, hrefRegistros: "/admin/registros" }}
        />
      </main>
    );
  } catch (e) {
    if (e instanceof ErroNaoEncontrado) notFound();
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin" />
          <h1>Central de coleta</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
