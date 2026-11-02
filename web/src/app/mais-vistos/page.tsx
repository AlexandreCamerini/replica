import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Mais vistos" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S17" title="Mais vistos" purpose="O que as pessoas estão consultando agora." release="R5" />
    </Container>
  );
}
