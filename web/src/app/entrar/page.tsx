import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Entrar" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S20" title="Entrar" purpose="Acompanhe pessoas e receba novidades por e-mail. Sem senha." release="R2" />
    </Container>
  );
}
