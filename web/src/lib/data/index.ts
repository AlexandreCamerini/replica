import { fakeSource } from "./fake";
import type { DataSource } from "./types";

// Ponto único de troca. DATA_SOURCE=pg passa a usar a implementação Postgres (replica-backend) sem tocar em tela.
export const data: DataSource = fakeSource;

export * from "./types";
