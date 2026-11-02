import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Planos de governo" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S13" title="Planos de governo" purpose="O que cada candidatura registrou no TSE, tema por tema." release="R5" />
    </Container>
  );
}
