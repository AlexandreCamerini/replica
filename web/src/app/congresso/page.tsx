import type { Metadata } from "next";
import { Container } from "@/components/page/page-header";
import { StubPage } from "@/components/page/stub";

export const metadata: Metadata = { title: "Congresso" };

export default function Page() {
  return (
    <Container>
      <StubPage id="S09" title="Congresso" purpose="O que está sendo votado em Brasília e como cada pessoa votou." release="R2" />
    </Container>
  );
}
