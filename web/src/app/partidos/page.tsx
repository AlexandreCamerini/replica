import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Partidos" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S11" title="Partidos" purpose="Bancadas, histórico e alinhamento com o governo, com critério público." release="R5" />
    </Container>
  );
}
