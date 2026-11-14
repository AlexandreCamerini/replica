import { Casco } from "@/components/sv/casco";

// Direção 2 (decisão do dono em 10/11/2026), promovida à raiz do site em 14/11/2026 (D316). Mesma camada de dados do
// desenho anterior, casco próprio. O título e a descrição padrão vêm do layout raiz; páginas pessoais (acompanhando,
// ajustes) declaram o próprio noindex.
export default function SvLayout({ children }: { children: React.ReactNode }) {
  return <Casco>{children}</Casco>;
}
