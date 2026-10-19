import { readFileSync } from "node:fs";
import { readTabularFile } from "@/lib/import/read-file";
import { detectColumns, rowsToDossiers } from "@/lib/import/dossiers";

export async function loadFixture(name: string) {
  const buf = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const sheet = await readTabularFile(name, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const { mapping, manquants } = detectColumns(sheet.headers);
  if (manquants.length) throw new Error("Colonnes manquantes : " + manquants.join(", "));
  return rowsToDossiers(sheet.rows, mapping, "2026-10-16");
}

export const reference = JSON.parse(readFileSync(new URL("./fixtures/04_clients.json", import.meta.url), "utf8")) as {
  clients: Record<string, any>[];
};
