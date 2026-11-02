import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Acompanhando" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S21" title="Acompanhando" purpose="As novidades das pessoas que você escolheu acompanhar." release="R2" />
    </Container>
  );
}
