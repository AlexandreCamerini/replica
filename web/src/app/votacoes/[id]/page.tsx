import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Votação" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S10" title="Votação" purpose="Placar, orientação de cada partido e o voto de cada pessoa." release="R2" />
    </Container>
  );
}
