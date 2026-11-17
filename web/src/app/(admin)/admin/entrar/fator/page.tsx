import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { FormFatorCadastro, FormFatorVerificar } from "@/components/admin-entrada/formularios";
import { clienteAuthDaCentral } from "@/lib/admin/cliente-auth";
import { exigirEntrada } from "@/lib/admin/guarda";
import { resolverOperador } from "@/lib/admin/sessao";

// Segundo fator (TOTP, obrigatório): cadastro no primeiro acesso, verificação depois. Só para sessão de admin ativo ainda em aal1; aal2 vai para a central, o resto é 404.
// O fator não se cria aqui, na renderização: o QR sai de uma server action (iniciarCadastroFator), para recarregar a página não acumular fatores sem verificar.
export const dynamic = "force-dynamic";

export default async function PaginaFator() {
  await exigirEntrada();
  const r = await resolverOperador();
  if (r.ok) redirect("/admin");
  if (r.destino !== "fator") notFound();
  const sb = await clienteAuthDaCentral();
  const { data } = await sb.auth.mfa.listFactors();
  const temFator = (data?.totp.length ?? 0) > 0; // `totp` só traz os fatores já verificados
  return (
    <main className="adm-pagina">
      <h1>{temFator ? "Confirme com o autenticador" : "Cadastre o autenticador"}</h1>
      <p className="adm-ajuda">
        {temFator ? "Digite o código de 6 números que o aplicativo autenticador mostra agora." : "A central exige um segundo fator. Cadastre um aplicativo autenticador (TOTP) para continuar."}
      </p>
      {temFator ? <FormFatorVerificar /> : <FormFatorCadastro />}
    </main>
  );
}
