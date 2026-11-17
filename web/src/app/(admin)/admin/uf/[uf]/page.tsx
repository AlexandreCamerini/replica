import Link from "next/link";
import { notFound } from "next/navigation";
import { AlternadorVisao, BlocoErro, BlocoTerritorioSemFicha, Navegacao } from "@/components/admin/blocos";
import { FormRecoleta, type ContagemClasse } from "@/components/admin/form-recoleta";
import { MapaCliente } from "@/components/admin/mapa-cliente";
import { PainelVivo, type EstadoApi } from "@/components/admin/painel-vivo";
import { agregarPais, agregarUf, formatarContagem } from "@/lib/admin/agregacao";
import { contarPendentes, LIMITE_FILA } from "@/lib/admin/confirmacao";
import { ErroLeituraBanco, estadoDoExecutor, fichas, fila, rodadas } from "@/lib/admin/consultas";
import { contagensDeAgregado, estadoDoTerritorio, serializavel, visaoDe } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { estadosDoMapa } from "@/lib/admin/mapa-dados";
import { nomeDaUf } from "@/lib/admin/rotulos";

export const dynamic = "force-dynamic";

export default async function PaginaUf({ params, searchParams }: { params: Promise<{ uf: string }>; searchParams: Promise<{ visao?: string; rodada?: string }> }) {
  await exigirAdmin();
  const { uf } = await params;
  const sp = await searchParams;
  if (!/^\d{2}$/.test(uf)) notFound();
  const visao = visaoDe(sp.visao);
  try {
    const [lista, todas, executor, itensFila] = await Promise.all([rodadas(50), fichas(), estadoDoExecutor(), fila(undefined, LIMITE_FILA)]);
    const nomeUf = nomeDaUf(uf);
    const contagensDeRecoleta: Partial<Record<"vinculo_sapl" | "cobertura" | "contato_mandato", ContagemClasse>> = Object.fromEntries(
      (["vinculo_sapl", "cobertura", "contato_mandato"] as const).map((c) => [c, contarPendentes(itensFila, c, { ibge: uf, nivel: "uf" })]),
    );
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
        <h1>{nomeUf}, por município</h1>
        <p>
          <Link href={`/admin?${qs}`} className="chip">
            Voltar ao Brasil
          </Link>
        </p>
        <p>
          Neste estado: <strong>{formatarContagem(ag.total)}</strong>. Da UF, sem município: <strong>{formatarContagem(ag.daUfSemMunicipio.total)}</strong>. Fichas de município: {formatarContagem(ag.total - ag.daUfSemMunicipio.total)}.
        </p>
        {estadoTerritorio === "territorio_sem_ficha" && <BlocoTerritorioSemFicha nome={nomeUf} />}
        <AlternadorVisao visao={visao} hrefColeta={`/admin/uf/${uf}?visao=coleta${rodadaId ? `&rodada=${rodadaId}` : ""}`} hrefRevisao={`/admin/uf/${uf}?visao=revisao${rodadaId ? `&rodada=${rodadaId}` : ""}`} />
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
          <FormRecoleta nivel="uf" ibge={uf} nome={nomeUf} contagens={contagensDeRecoleta} />
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
          <h1>{nomeDaUf(uf)}, por município</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
