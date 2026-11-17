import Link from "next/link";
import { notFound } from "next/navigation";
import { BlocoErro, Navegacao } from "@/components/admin/blocos";
import { ErroLeituraBanco, ErroPedidoInvalido, fila } from "@/lib/admin/consultas";
import { mostrarValor, textoData } from "@/lib/admin/estado-tela";
import { exigirAdmin } from "@/lib/admin/guarda";
import { CLASSES } from "@/lib/admin/tipos";

export const dynamic = "force-dynamic";

const NOME_CLASSE: Record<string, string> = { vinculo_sapl: "Vínculo SAPL", cobertura: "Cobertura", contato_mandato: "Contato do mandato", identidade: "Identidade" };

export default async function PaginaFila({ searchParams }: { searchParams: Promise<{ classe?: string }> }) {
  exigirAdmin();
  const sp = await searchParams;
  const classe = typeof sp.classe === "string" && sp.classe !== "" ? sp.classe : undefined;
  try {
    // A ordem é a da consulta (classe, tipo, vencimento, cobertura do recorte, id). Nunca se reordena aqui, nem por pessoa, partido ou popularidade.
    const itens = await fila(classe, 200);
    return (
      <main className="adm-pagina">
        <Navegacao atual="/admin/fila" />
        <h1>Fila de pendências</h1>
        <p className="adm-ajuda">Na ordem da consulta: classe do campo, tipo de pendência, vencimento, cobertura do recorte e identificador. Nenhum dado de pessoa ou de partido entra na ordem.</p>
        <nav aria-label="Filtro por classe" className="adm-visao">
          <Link href="/admin/fila" aria-current={classe === undefined ? "page" : undefined}>
            Todas
          </Link>
          {CLASSES.map((c) => (
            <Link key={c} href={`/admin/fila?classe=${c}`} aria-current={classe === c ? "page" : undefined}>
              {NOME_CLASSE[c]}
            </Link>
          ))}
        </nav>
        <p>
          <strong>{itens.length}</strong> {itens.length === 1 ? "pendência" : "pendências"} na lista{itens.length === 200 ? " (limite de 200 na tela)" : ""}.
        </p>
        <ol className="adm-lista">
          {itens.map((i) => (
            <li key={i.id} className="adm-item" data-pendencia={i.id}>
              <p>
                <Link href={`/admin/ficha/${i.classe}/${encodeURIComponent(i.registro_chave)}`}>
                  {i.rotulo ?? i.registro_chave} ({NOME_CLASSE[i.classe] ?? i.classe})
                </Link>{" "}
                campo <strong>{i.campo}</strong>, tipo {i.tipo}
                {i.reaberta && <span className="adm-marca"> reaberta: {i.motivo_reabertura ?? "motivo não registrado"}</span>}
              </p>
              <p>Pergunta: {i.pergunta}</p>
              <p className="adm-ajuda">
                Vence em: {i.vence_em ? textoData(i.vence_em) : "sem prazo"}. Cobertura do recorte: {i.cobertura_recorte === null ? "desconhecida" : mostrarValor(i.cobertura_recorte)}.
              </p>
              {i.propostas.map((p, k) => (
                <p key={k} className="adm-ajuda">
                  Proposta: {mostrarValor((p as Record<string, unknown>).valor_candidato)} (vigente {mostrarValor((p as Record<string, unknown>).valor_vigente)}), evidência {mostrarValor((p as Record<string, unknown>).url)}
                </p>
              ))}
            </li>
          ))}
        </ol>
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
