import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Como ajudar" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S26" title="Como ajudar" purpose="Jeitos de ajudar a cobrir mais cidades." release="R5" />
    </Container>
  );
}
