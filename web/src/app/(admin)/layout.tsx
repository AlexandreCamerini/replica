import type { Metadata } from "next";
import type { ReactNode } from "react";
import { exigirAdmin } from "@/lib/admin/guarda";
import "@/styles/admin.css";

// Central de administração de coleta. Só local: sem ADMIN_CENTRAL=1, ou com VERCEL/VERCEL_ENV definida, tudo daqui responde 404.
// A trava é a PRIMEIRA instrução do layout, antes de qualquer Suspense ou loading.tsx (com o stream já iniciado, `notFound()` pode sair com status 200).
// Este grupo NÃO tem Suspense nem loading.tsx por isso. O site público não tem link para cá e nada daqui entra em menu, rodapé ou sitemap.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "Central de coleta" },
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  exigirAdmin();
  return <div className="admin-central">{children}</div>;
}
