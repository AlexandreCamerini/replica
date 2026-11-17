import { redirect } from "next/navigation";
import { FormCodigo, FormEmail } from "@/components/admin-entrada/formularios";
import { exigirEntrada } from "@/lib/admin/guarda";
import { resolverOperador } from "@/lib/admin/sessao";

// Entrada da central: e-mail -> código por e-mail -> (fator) -> central. ÚNICA página da central que responde sem sessão, e só em modo produção, com o Host da central.
// Mensagem sempre neutra: nada aqui diz se um e-mail é de administrador. Quem já tem sessão de admin vai direto adiante.
export const dynamic = "force-dynamic";

type Busca = { etapa?: string };

export default async function PaginaEntrar({ searchParams }: { searchParams: Promise<Busca> }) {
  await exigirEntrada();
  const r = await resolverOperador();
  if (r.ok) redirect("/admin");
  if (r.destino === "fator") redirect("/admin/entrar/fator");
  const { etapa } = await searchParams;
  const codigo = etapa === "codigo";
  return (
    <main className="adm-pagina">
      <h1>{codigo ? "Confira seu e-mail" : "Entrar na central"}</h1>
      <p className="adm-ajuda">Acesso restrito. Código por e-mail, depois o código do aplicativo autenticador.</p>
      {codigo ? (
        <>
          <p className="adm-ajuda">Se este e-mail for de um administrador, o código foi enviado. Confira a caixa de entrada e o spam; ele vale por 10 minutos.</p>
          <FormCodigo />
        </>
      ) : (
        <FormEmail />
      )}
    </main>
  );
}
