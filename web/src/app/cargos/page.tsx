import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Entenda os cargos" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S18" title="Entenda os cargos" purpose="O que faz cada cargo eletivo e quem fiscaliza quem." release="R5" />
    </Container>
  );
}
