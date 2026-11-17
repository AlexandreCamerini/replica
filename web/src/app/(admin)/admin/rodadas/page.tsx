import Link from "next/link";
import { BlocoErro, BlocoVazio, Navegacao } from "@/components/admin/blocos";
import { ErroLeituraBanco, rodadas } from "@/lib/admin/consultas";
import { estadoDaRodada, textoData } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";

export const dynamic = "force-dynamic";

const NOME_ESTADO = { rodada_em_andamento: "em andamento", rodada_interrompida: "interrompida", rodada_concluida: "concluída" } as const;

export default async function PaginaRodadas() {
  await exigirAdmin();
  try {
    const lista = await rodadas(100);
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin/rodadas" />
        <h1>Rodadas</h1>
        {lista.length === 0 ? (
          <BlocoVazio />
        ) : (
          <ul className="adm-lista">
            {lista.map((r) => {
              const estado = estadoDaRodada(r.status as string);
              return (
                <li key={String(r.id)} className="adm-item" data-estado={estado}>
                  <Link href={`/admin/rodadas/${r.id}`}>
                    {String(r.coletor)} ({String(r.modo)})
                  </Link>{" "}
                  {NOME_ESTADO[estado]} (status {String(r.status)}), iniciada em {textoData(r.iniciada_em)}
                  {r.finalizada_em ? `, finalizada em ${textoData(r.finalizada_em)}` : ""}. {String(r.tentativas)} tentativas.
                  {r.so_pendencias === true ? " Só pendências." : ""}
                </li>
              );
            })}
          </ul>
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
