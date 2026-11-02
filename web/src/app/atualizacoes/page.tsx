import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Novidades" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S24" title="Novidades" purpose="O que mudou nos dados e no site." release="R2" />
    </Container>
  );
}
