import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Como funciona" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S22" title="Como funciona" purpose="De onde vêm os dados, como contamos e o que nunca fazemos." release="R2" />
    </Container>
  );
}
