import Link from "next/link";
import { BlocoErro, BlocoTerritorioSemFicha, Navegacao } from "@/components/admin/blocos";
import { FormRecoleta } from "@/components/admin/form-recoleta";
import { formatarContagem, verRegistros } from "@/lib/admin/agregacao";
import { ErroLeituraBanco, fichas } from "@/lib/admin/consultas";
import { estadoDoTerritorio } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import type { FiltroRegistros } from "@/lib/admin/tipos";

export const dynamic = "force-dynamic";

export default async function PaginaRegistros({ searchParams }: { searchParams: Promise<{ uf?: string; municipio?: string }> }) {
  exigirAdmin();
  const sp = await searchParams;
  const uf = typeof sp.uf === "string" && /^\d{2}$/.test(sp.uf) ? sp.uf : null;
  const municipio = typeof sp.municipio === "string" && /^\d{7}$/.test(sp.municipio) ? sp.municipio : null;
  const filtro: FiltroRegistros = municipio ? { nivel: "municipio", ibge: municipio } : uf ? { nivel: "uf", ibge: uf } : { nivel: "pais" };
  const nome = municipio ? `município ${municipio}` : uf ? `estado ${uf}` : "Brasil";
  try {
    const lista = verRegistros(await fichas(), filtro);
    const semMapa = lista.filter((r) => r.motivo);
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin" />
        <h1>Registros: {nome}</h1>
        <p>
          <Link href={uf ? `/admin/uf/${uf}` : "/admin"}>Voltar ao mapa</Link>
        </p>
        <p>
          <strong>{formatarContagem(lista.length)}</strong>, das quais <strong>{formatarContagem(semMapa.length)}</strong> sem ponto no mapa (cada uma com o motivo). Esta lista é o equivalente em texto do mapa.
        </p>
        {estadoDoTerritorio(lista.length) === "territorio_sem_ficha" && <BlocoTerritorioSemFicha nome={nome} />}
        <ul className="adm-lista">
          {lista.map((r) => (
            <li key={r.id} className="adm-item">
              <Link href={`/admin/ficha/${r.ficha.classe}/${encodeURIComponent(r.ficha.chave)}`}>
                {r.ficha.rotulo} ({r.id})
              </Link>
              {r.aproximada && <span className="adm-marca"> posição aproximada (registro de UF mostrado no estado, não num município)</span>}
              {r.textoMotivo && <p className="adm-ajuda">Fora do mapa: {r.textoMotivo}</p>}
            </li>
          ))}
        </ul>
        {(municipio || uf) && (
          <section className="adm-bloco" aria-labelledby="adm-rec-t">
            <h2 id="adm-rec-t">Recoletar fichas pendentes</h2>
            <FormRecoleta nivel={municipio ? "municipio" : "uf"} ibge={municipio ?? uf ?? undefined} nome={nome} />
          </section>
        )}
      </main>
    );
  } catch (e) {
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin" />
          <h1>Registros: {nome}</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
