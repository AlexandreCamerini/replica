import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Quem publica dados" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S23" title="Quem publica dados" purpose="Quais órgãos publicam cada dado em formato aberto." release="R2" />
    </Container>
  );
}
