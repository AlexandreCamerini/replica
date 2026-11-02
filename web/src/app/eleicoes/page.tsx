import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Eleições" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S14" title="Eleições" purpose="Resultados oficiais por lugar e o histórico de quem venceu." release="R5" />
    </Container>
  );
}
