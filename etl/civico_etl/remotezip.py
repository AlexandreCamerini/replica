"""Lê membros de um zip remoto por HTTP Range, sem baixar o arquivo inteiro.

Os zips do TSE têm centenas de MB e dezenas de CSVs (um por UF + consolidado). O diretório central fica no fim do
arquivo: lendo-o por Range, abrimos só o membro que interessa e o descomprimimos em fluxo, com buffer de 8 MB por
requisição. O CRC32 de cada membro, publicado no próprio zip, serve de checksum para o contrato de run.
"""

from __future__ import annotations

import csv
import io
import zipfile
from typing import Iterator

from .http import UA, client


class RangeFile(io.RawIOBase):
    def __init__(self, url: str, buffer: int = 8 << 20):
        self.url = url
        self.buffer = buffer
        r = client().head(url, headers={"User-Agent": UA})
        if r.status_code == 404:
            raise FileNotFoundError(url)
        r.raise_for_status()
        if r.headers.get("accept-ranges", "bytes") == "none":
            raise RuntimeError(f"servidor não aceita Range: {url}")
        self.size = int(r.headers["content-length"])
        self.pos = 0
        self._b0 = 0
        self._buf = b""

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        if not (self._b0 <= self.pos and self.pos + n <= self._b0 + len(self._buf)):
            end = min(self.pos + max(n, self.buffer), self.size) - 1
            for attempt in range(4):
                try:
                    r = client().get(self.url, headers={"Range": f"bytes={self.pos}-{end}", "User-Agent": UA})
                    if r.status_code != 206:
                        raise RuntimeError(f"Range ignorado ({r.status_code}) em {self.url}")
                    self._buf, self._b0 = r.content, self.pos
                    break
                except Exception:  # noqa: BLE001 - retenta rede
                    if attempt == 3:
                        raise
        off = self.pos - self._b0
        out = self._buf[off : off + n]
        self.pos += len(out)
        return out


def open_remote(url: str) -> zipfile.ZipFile:
    return zipfile.ZipFile(RangeFile(url))


def pick_members(z: zipfile.ZipFile, prefix: str) -> list[zipfile.ZipInfo]:
    """Consolidado nacional quando existe (…_BRASIL.csv + …_BR.csv da eleição presidencial); senão, todos os de UF."""
    infos = [i for i in z.infolist() if i.filename.lower().endswith(".csv") and i.filename.startswith(prefix)]
    brasil = [i for i in infos if i.filename.upper().endswith("_BRASIL.CSV")]
    br = [i for i in infos if i.filename.upper().endswith("_BR.CSV")]
    return (brasil + br) if brasil else infos


def rows(z: zipfile.ZipFile, info: zipfile.ZipInfo, cols: list[str]) -> Iterator[tuple[str, ...]]:
    """Linhas do CSV do TSE (latin-1, ';') só com as colunas pedidas, em fluxo."""
    with z.open(info) as raw:
        reader = csv.reader(io.TextIOWrapper(raw, encoding="latin-1", newline=""), delimiter=";", quotechar='"')
        header = next(reader)
        idx = [header.index(c) if c in header else -1 for c in cols]
        for r in reader:
            yield tuple(r[i] if 0 <= i < len(r) else "" for i in idx)


def checksum(infos: list[zipfile.ZipInfo]) -> str:
    return ",".join(f"{i.filename}:{i.CRC:08x}:{i.file_size}" for i in infos)
