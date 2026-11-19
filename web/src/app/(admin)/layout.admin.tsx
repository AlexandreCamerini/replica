import type { Metadata } from "next";
import type { ReactNode } from "react";
import { exigirAdminOuEntrada } from "@/lib/admin/guarda";
import "@/styles/admin.css";

// Central de administração de coleta. Dois modos (AC-23): local (ADMIN_CENTRAL=1, fora da Vercel) e produção (ADMIN_CENTRAL=producao, só em admin.segueovoto.com.br).
// Fechada, ou quem pede não é admin com MFA (produção) / ADMIN_LOCAL_EMAIL ativo em adm_admins (local): tudo daqui responde 404.
// A trava é a PRIMEIRA instrução do layout, antes de qualquer Suspense ou loading.tsx (com o stream já iniciado, `notFound()` pode sair com status 200).
// `exigirAdminOuEntrada` é `exigirAdmin` mais uma exceção: as páginas de /admin/entrar (marcadas pelo middleware) não exigem admin, porque quem entra ainda não tem sessão.
// Este grupo NÃO tem Suspense nem loading.tsx por isso. O site público não tem link para cá e nada daqui entra em menu, rodapé ou sitemap.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Central de coleta" },
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await exigirAdminOuEntrada();
  return <div className="admin-central">{children}</div>;
}
