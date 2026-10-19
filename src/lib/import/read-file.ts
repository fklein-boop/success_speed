import * as XLSX from "xlsx";
import Papa from "papaparse";
import { findHeaderRow } from "./dossiers";

export interface Sheet {
  nomFeuille: string | null;
  headers: unknown[];
  rows: unknown[][];
}

/**
 * Lit un fichier xlsx ou csv et renvoie la feuille qui contient l'export dossiers
 * (repérée par les colonnes IDresa et IDagence), ou la première feuille sinon.
 */
export async function readTabularFile(name: string, data: ArrayBuffer): Promise<Sheet> {
  if (/\.(csv|txt)$/i.test(name)) {
    let text = new TextDecoder("utf-8").decode(data);
    // Exports Windows éventuels en latin-1 : présence de caractères de remplacement
    if (text.includes("�")) text = new TextDecoder("windows-1252").decode(data);
    text = text.replace(/^﻿/, "");
    const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy", delimitersToGuess: [";", ",", "\t", "|"] });
    const matrix = res.data as unknown[][];
    const h = Math.max(0, findHeaderRow(matrix));
    return { nomFeuille: null, headers: matrix[h] ?? [], rows: matrix.slice(h + 1) };
  }
  const wb = XLSX.read(data, { type: "array", cellDates: false, dense: true });
  for (const nom of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nom], { header: 1, raw: true, defval: null, blankrows: false });
    const h = findHeaderRow(matrix);
    if (h >= 0) return { nomFeuille: nom, headers: matrix[h], rows: matrix.slice(h + 1) };
  }
  const nom = wb.SheetNames[0];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nom], { header: 1, raw: true, defval: null, blankrows: false });
  return { nomFeuille: nom, headers: matrix[0] ?? [], rows: matrix.slice(1) };
}
