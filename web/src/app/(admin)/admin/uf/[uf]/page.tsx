import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, BlocoTerritorioSemFicha, Navegacao } from "@/components/admin/blocos";
import { FormRecoleta } from "@/components/admin/form-recoleta";
import { MapaCliente } from "@/components/admin/mapa-cliente";
import { PainelVivo, type EstadoApi } from "@/components/admin/painel-vivo";
import { agregarPais, agregarUf, formatarContagem } from "@/lib/admin/agregacao";
import { ErroLeituraBanco, estadoDoExecutor, fichas, rodadas } from "@/lib/admin/consultas";
import { contagensDeAgregado, estadoDoTerritorio, serializavel, visaoDe } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { estadosDoMapa } from "@/lib/admin/mapa-dados";

export const dynamic = "force-dynamic";

export default async function PaginaUf({ params, searchParams }: { params: Promise<{ uf: string }>; searchParams: Promise<{ visao?: string; rodada?: string }> }) {
  exigirAdmin();
  const { uf } = await params;
  const sp = await searchParams;
  if (!/^\d{2}$/.test(uf)) notFound();
  const visao = visaoDe(sp.visao);
  try {
    const [lista, todas, executor] = await Promise.all([rodadas(50), fichas(), estadoDoExecutor()]);
    const rodadaId = typeof sp.rodada === "string" && sp.rodada !== "" ? sp.rodada : ((lista[0]?.id as string | undefined) ?? null);
    const statusRodada = (lista.find((r) => r.id === rodadaId)?.status as string | undefined) ?? null;
    const estados = await estadosDoMapa(visao, todas, rodadaId, statusRodada);
    const ag = agregarUf(todas, uf);
    const pais = agregarPais(todas);
    const padrao = visao === "coleta" ? "sem_tentativa" : "sem_pendencia";
    const contagens: [string, number, string][] = [...ag.porMunicipio].map(([m, c]) => [m, c.total, estados.get(`mun:${m}`) ?? padrao]);
    const inicial = serializavel({ ...executor, mapa: contagensDeAgregado(pais) }) as unknown as EstadoApi;
    const qs = `visao=${visao}${rodadaId ? `&rodada=${rodadaId}` : ""}`;
    const estadoTerritorio = estadoDoTerritorio(ag.total);

    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin" />
        <h1>Estado {uf}, por município</h1>
        <p>
          <Link href={`/admin?${qs}`}>Voltar ao Brasil</Link>
        </p>
        <nav aria-label="Visão do mapa" className="adm-visao">
          <Link href={`/admin/uf/${uf}?visao=coleta${rodadaId ? `&rodada=${rodadaId}` : ""}`} aria-current={visao === "coleta" ? "page" : undefined}>
            Coleta
          </Link>
          <Link href={`/admin/uf/${uf}?visao=revisao${rodadaId ? `&rodada=${rodadaId}` : ""}`} aria-current={visao === "revisao" ? "page" : undefined}>
            Revisão
          </Link>
        </nav>
        <p>
          Neste estado: <strong>{formatarContagem(ag.total)}</strong>. Da UF, sem município: <strong>{formatarContagem(ag.daUfSemMunicipio.total)}</strong>. Fichas de município: {formatarContagem(ag.total - ag.daUfSemMunicipio.total)}.
        </p>
        {estadoTerritorio === "territorio_sem_ficha" && <BlocoTerritorioSemFicha nome={`Estado ${uf}`} />}
        <MapaCliente
          nivel={{ tipo: "uf", uf }}
          contagens={contagens}
          semMunicipio={ag.daUfSemMunicipio.total}
          semTerritorio={pais.semTerritorio.total}
          hrefRegistros={`/admin/registros?uf=${uf}`}
          visao={visao}
          hrefBaseUf="/admin/uf/"
          hrefBaseMunicipio="/admin/registros?uf="
          hrefVoltar={`/admin?${qs}`}
        />
        <section className="adm-bloco" aria-labelledby="adm-rec-t">
          <h2 id="adm-rec-t">Recoletar fichas pendentes</h2>
          <FormRecoleta nivel="uf" ibge={uf} nome={`Estado ${uf}`} />
          <p>
            <Link href={`/admin/registros?uf=${uf}`}>Ver registros do estado</Link>
          </p>
        </section>
        <PainelVivo inicial={inicial} rodada={null} relatorio={null} mostrarPaineis={false} />
      </main>
    );
  } catch (e) {
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin" />
          <h1>Estado {uf}, por município</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
