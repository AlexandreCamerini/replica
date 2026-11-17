"use client";

import { useMemo } from "react";
import { MapaAdmin, type ContagemTerritorio } from "./mapa-admin.tsx";
import type { EstadoTerritorio, Visao } from "./mapa-escala.ts";

/** Ponte servidor -> mapa: o mapa recebe `Map` e funções, que não atravessam a fronteira; aqui chegam só dados serializáveis e os hrefs são montados no cliente. */
export type MapaClienteProps = {
  nivel: { tipo: "pais" } | { tipo: "uf"; uf: string };
  /** [ibge, total, estado] */
  contagens: [string, number, string][];
  semMunicipio?: number;
  semTerritorio: number;
  hrefRegistros: string;
  visao: Visao;
  /** montagem do href de cada território: país abre a UF; UF abre os registros do município */
  hrefBaseUf: string;
  hrefBaseMunicipio: string;
  hrefVoltar: string;
};

export function MapaCliente(p: MapaClienteProps) {
  const contagens = useMemo(() => new Map<string, ContagemTerritorio>(p.contagens.map(([k, total, estado]) => [k, { total, estado: estado as EstadoTerritorio }])), [p.contagens]);
  const ufDoPais = p.nivel.tipo === "uf" ? p.nivel.uf : "";
  return (
    <MapaAdmin
      nivel={p.nivel}
      contagens={contagens}
      semMunicipio={p.semMunicipio}
      semTerritorio={p.semTerritorio}
      hrefRegistros={p.hrefRegistros}
      visao={p.visao}
      hrefTerritorio={(ibge) => (p.nivel.tipo === "pais" ? `${p.hrefBaseUf}${ibge}?visao=${p.visao}` : `${p.hrefBaseMunicipio}${ufDoPais}&municipio=${ibge}&visao=${p.visao}`)}
      hrefVoltar={p.hrefVoltar}
    />
  );
}
