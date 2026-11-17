import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, Navegacao, Selo } from "@/components/admin/blocos";
import { ErroLeituraBanco, ErroPedidoInvalido, fila } from "@/lib/admin/consultas";
import { mostrarValor } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { nomesDeMunicipios } from "@/lib/admin/nomes-geo";
import { motivoDaReabertura, NOME_CLASSE, nomeDaClasse, nomeDoTerritorio, tipoDaPendencia, type TerritorioRef } from "@/lib/admin/rotulos";
import { dataComRelativo } from "@/lib/admin/tempo";
import { CLASSES } from "@/lib/admin/tipos";

export const dynamic = "force-dynamic";

const LIMITE = 200;

export default async function PaginaFila({ searchParams }: { searchParams: Promise<{ classe?: string }> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const classe = typeof sp.classe === "string" && sp.classe !== "" ? sp.classe : undefined;
  try {
    // A ordem é a da consulta (classe, tipo, vencimento, cobertura do recorte, id). Nunca se reordena aqui, nem por pessoa, partido ou popularidade.
    const itens = await fila(classe, LIMITE);
    const nomes = await nomesDeMunicipios(itens.flatMap((i) => (i.territorio?.nivel === "municipio" ? [i.territorio.ibge] : [])));
    const agora = new Date();
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin/fila" />
        <h1>Fila de pendências</h1>
        <p className="adm-ajuda">Na ordem da consulta: classe do campo, tipo de pendência, vencimento, cobertura do recorte e identificador. Nenhum dado de pessoa ou de partido entra na ordem.</p>
        <nav aria-label="Filtro por classe" className="adm-visao">
          <Link href="/admin/fila" className="chip" aria-current={classe === undefined ? "page" : undefined}>
            Todas
          </Link>
          {CLASSES.map((c) => (
            <Link key={c} href={`/admin/fila?classe=${c}`} className="chip" aria-current={classe === c ? "page" : undefined}>
              {NOME_CLASSE[c]}
            </Link>
          ))}
        </nav>
        <p>
          <strong className="adm-num">{itens.length}</strong> {itens.length === 1 ? "pendência" : "pendências"} na lista{itens.length === LIMITE ? ` (limite de ${LIMITE} na tela)` : ""}.
        </p>
        {itens.length > 0 && (
          <div className="adm-rolagem" tabIndex={0} role="region" aria-label="Fila de pendências (role para o lado em tela pequena)">
            <table className="adm-tabela">
              <caption className="adm-sr">Pendências abertas, na ordem da fila</caption>
              <thead>
                <tr>
                  <th scope="col">Ficha</th>
                  <th scope="col">Classe</th>
                  <th scope="col">Campo</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Vence</th>
                  <th scope="col" className="adm-num">
                    Cobertura
                  </th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => {
                  const t = i.territorio as TerritorioRef | null;
                  const territorio = nomeDoTerritorio(t, t?.nivel === "municipio" ? nomes.get(t.ibge) : null);
                  const propostas = i.propostas as Record<string, unknown>[];
                  return (
                    <tr key={i.id} data-pendencia={i.id}>
                      <th scope="row">
                        <Link href={`/admin/ficha/${i.classe}/${encodeURIComponent(i.registro_chave)}`}>{i.rotulo ?? "Ficha sem rótulo"}</Link>
                        <span className="adm-ajuda adm-bloco-linha">{t ? territorio : "sem território no mapa"}</span>
                        {i.reaberta && (
                          <span className="adm-bloco-linha">
                            <Selo>Reaberta</Selo> <span className="adm-ajuda">{motivoDaReabertura(i.motivo_reabertura)}</span>
                          </span>
                        )}
                        <details className="adm-ids">
                          <summary>Pergunta e proposta</summary>
                          <p>{i.pergunta}</p>
                          {propostas.map((p, k) => (
                            <p key={k} className="adm-ajuda">
                              Proposta: {mostrarValor(p.valor_candidato)} (vigente {mostrarValor(p.valor_vigente)}), evidência {mostrarValor(p.url)}
                            </p>
                          ))}
                        </details>
                      </th>
                      <td>{nomeDaClasse(i.classe)}</td>
                      <td>{i.campo}</td>
                      <td>{tipoDaPendencia(i.tipo)}</td>
                      <td>{i.vence_em ? dataComRelativo(i.vence_em, agora) : "sem prazo"}</td>
                      <td className="adm-num">{i.cobertura_recorte === null ? "desconhecida" : mostrarValor(i.cobertura_recorte)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {itens.length === 0 && <p>Nenhuma pendência aberta{classe ? " nesta classe" : ""}.</p>}
      </main>
    );
  } catch (e) {
    if (e instanceof ErroPedidoInvalido) notFound();
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin/fila" />
          <h1>Fila de pendências</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
