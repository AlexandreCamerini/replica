import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Dicionário" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S19" title="Dicionário" purpose="Os termos da política explicados em linguagem simples." release="R5" />
    </Container>
  );
}
