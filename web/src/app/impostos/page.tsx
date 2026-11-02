import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Impostos" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S16" title="Impostos" purpose="Quanto a União arrecadou, por estado e por mês." release="R5" />
    </Container>
  );
}
