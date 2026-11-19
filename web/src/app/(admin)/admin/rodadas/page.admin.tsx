import Link from "next/link";
import { BlocoErro, BlocoVazio, Navegacao, Selo } from "@/components/admin/blocos";
import { FormRodada } from "@/components/admin/form-rodada";
import { ErroLeituraBanco, rodadas } from "@/lib/admin/consultas";
import { estadoDaRodada } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { modoDaRodada, statusDaRodada } from "@/lib/admin/rotulos";
import { dataComRelativo } from "@/lib/admin/tempo";

export const dynamic = "force-dynamic";

const NOME_ESTADO = { rodada_em_andamento: "Em andamento", rodada_interrompida: "Interrompida", rodada_concluida: "Concluída" } as const;

export default async function PaginaRodadas() {
  await exigirAdmin();
  try {
    const lista = await rodadas(100);
    const agora = new Date();
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin/rodadas" />
        <h1>Rodadas</h1>
        <section className="adm-bloco" aria-labelledby="adm-abrir-t">
          <h2 id="adm-abrir-t">Abrir rodada</h2>
          <p className="adm-ajuda">Escolha o coletor do catálogo. A tela só oferece os modos e os recortes que ele suporta e pede confirmação antes de enviar.</p>
          <FormRodada />
        </section>
        {lista.length === 0 ? (
          <BlocoVazio comFormulario={false} />
        ) : (
          <div className="adm-rolagem" tabIndex={0} role="region" aria-label="Rodadas (role para o lado em tela pequena)">
            <table className="adm-tabela">
              <caption className="adm-sr">Rodadas de coleta, da mais recente para a mais antiga</caption>
              <thead>
                <tr>
                  <th scope="col">Coletor</th>
                  <th scope="col">Modo</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Iniciada</th>
                  <th scope="col">Finalizada</th>
                  <th scope="col" className="adm-num">
                    Tentativas
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => {
                  const estado = estadoDaRodada(r.status as string);
                  return (
                    <tr key={String(r.id)} data-estado={estado}>
                      <th scope="row">
                        <Link href={`/admin/rodadas/${r.id}`}>{String(r.coletor)}</Link>
                        {r.so_pendencias === true && <span className="adm-ajuda adm-bloco-linha">só pendências</span>}
                      </th>
                      <td>{modoDaRodada(String(r.modo))}</td>
                      <td>
                        <Selo>{NOME_ESTADO[estado]}</Selo> <span className="adm-ajuda">{statusDaRodada(String(r.status))}</span>
                      </td>
                      <td>{dataComRelativo(r.iniciada_em, agora)}</td>
                      <td>{r.finalizada_em ? dataComRelativo(r.finalizada_em, agora) : "ainda não"}</td>
                      <td className="adm-num">{String(r.tentativas)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    );
  } catch (e) {
    if (e instanceof ErroLeituraBanco) {
      return (
        <main className="adm-pagina">
          <Navegacao atual="/admin/rodadas" />
          <h1>Rodadas</h1>
          <BlocoErro />
        </main>
      );
    }
    throw e;
  }
}
