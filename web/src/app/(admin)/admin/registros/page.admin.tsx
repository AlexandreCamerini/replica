import Link from "next/link";
import { BlocoErro, BlocoTerritorioSemFicha, Navegacao } from "@/components/admin/blocos";
import { FormRecoleta, type ContagemClasse } from "@/components/admin/form-recoleta";
import { formatarContagem, verRegistros } from "@/lib/admin/agregacao";
import { contarPendentes, LIMITE_FILA } from "@/lib/admin/confirmacao";
import { ErroLeituraBanco, fichas, fila } from "@/lib/admin/consultas";
import { estadoDoTerritorio } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { nomeDeMunicipio } from "@/lib/admin/nomes-geo";
import { nomeDaClasse, nomeDaUf, nomeDoTerritorio } from "@/lib/admin/rotulos";
import type { FiltroRegistros } from "@/lib/admin/tipos";

export const dynamic = "force-dynamic";

const CLASSES_RECOLETA = ["vinculo_sapl", "cobertura", "contato_mandato"] as const;

export default async function PaginaRegistros({ searchParams }: { searchParams: Promise<{ uf?: string; municipio?: string }> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const uf = typeof sp.uf === "string" && /^\d{2}$/.test(sp.uf) ? sp.uf : null;
  const municipio = typeof sp.municipio === "string" && /^\d{7}$/.test(sp.municipio) ? sp.municipio : null;
  const filtro: FiltroRegistros = municipio ? { nivel: "municipio", ibge: municipio } : uf ? { nivel: "uf", ibge: uf } : { nivel: "pais" };
  try {
    const nomeMunicipio = municipio ? await nomeDeMunicipio(municipio) : null;
    const nome = municipio ? nomeDoTerritorio({ nivel: "municipio", ibge: municipio }, nomeMunicipio) : uf ? nomeDaUf(uf) : "Brasil";
    const lista = verRegistros(await fichas(), filtro);
    const semMapa = lista.filter((r) => r.motivo);
    let contagens: Partial<Record<(typeof CLASSES_RECOLETA)[number], ContagemClasse>> | undefined;
    if (municipio || uf) {
      const itens = await fila(undefined, LIMITE_FILA);
      const t = municipio ? { ibge: municipio, nivel: "municipio" } : { ibge: uf as string, nivel: "uf" };
      contagens = Object.fromEntries(CLASSES_RECOLETA.map((c) => [c, contarPendentes(itens, c, t)]));
    }
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin" />
        <h1>Registros: {nome}</h1>
        <p>
          <Link href={uf ? `/admin/uf/${uf}` : "/admin"} className="chip">
            Voltar ao mapa
          </Link>
        </p>
        <p>
          <strong>{formatarContagem(lista.length)}</strong>, das quais <strong>{formatarContagem(semMapa.length)}</strong> sem ponto no mapa (cada uma com o motivo). Esta lista é o equivalente em texto do mapa.
        </p>
        {estadoDoTerritorio(lista.length) === "territorio_sem_ficha" && <BlocoTerritorioSemFicha nome={nome} />}
        {lista.length > 0 && (
          <div className="adm-rolagem" tabIndex={0} role="region" aria-label="Registros (role para o lado em tela pequena)">
            <table className="adm-tabela">
              <caption className="adm-sr">Fichas do território</caption>
              <thead>
                <tr>
                  <th scope="col">Ficha</th>
                  <th scope="col">Classe</th>
                  <th scope="col">Posição no mapa</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      <Link href={`/admin/ficha/${r.ficha.classe}/${encodeURIComponent(r.ficha.chave)}`}>{r.ficha.rotulo}</Link>
                    </th>
                    <td>{nomeDaClasse(r.ficha.classe)}</td>
                    <td>
                      {r.textoMotivo ? <span className="adm-ajuda">Fora do mapa: {r.textoMotivo}</span> : r.aproximada ? "aproximada: registro de UF mostrado no estado, não num município" : "no mapa"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(municipio || uf) && (
          <section className="adm-bloco" aria-labelledby="adm-rec-t">
            <h2 id="adm-rec-t">Recoletar fichas pendentes</h2>
            <FormRecoleta nivel={municipio ? "municipio" : "uf"} ibge={municipio ?? uf ?? undefined} nome={nome} contagens={contagens} />
          </section>
        )}
      </main>
    );
  } catch (e) {
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin" />
          <h1>Registros: {municipio ? `município ${municipio}` : uf ? nomeDaUf(uf) : "Brasil"}</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
