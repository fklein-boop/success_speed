import { describe, it, expect } from "vitest";
import { detectColumns, normalizeHeader, parseAmount, parseDate, rowsToDossiers } from "@/lib/import/dossiers";
import { loadFixture } from "./helpers";

describe("Lecture de l'export", () => {
  it("normalise les en-têtes (casse, accents, espaces)", () => {
    expect(normalizeHeader("Statut d'origine du dossier")).toBe("statutdoriginedudossier");
    expect(normalizeHeader("  ERREUR  Résalive ")).toBe("erreurresalive");
  });

  it("reconnaît les colonnes même renommées en casse/accents", () => {
    const { mapping, manquants } = detectColumns(["IDAGENCE", "idresa", "DATE DE RESERVATION", "statut du dossier", "Statut d’origine du dossier", "total du dossier", "erreur resalive"]);
    expect(manquants).toEqual([]);
    expect(mapping.date).toBe(2);
  });

  it("signale les colonnes manquantes et utilise la correspondance mémorisée", () => {
    const headers = ["IDagence", "Numéro", "Date de réservation", "Statut du dossier", "Statut d'origine du dossier", "Total du dossier", "Erreur RésaLive"];
    expect(detectColumns(headers).manquants).toEqual(["idResa"]);
    expect(detectColumns(headers, { numero: "idResa" }).mapping.idResa).toBe(1);
  });

  it("lit dates et montants au format français", () => {
    expect(parseDate("04/01/2025")).toBe("2025-01-04");
    expect(parseDate(45661)).toBe("2025-01-04");
    expect(parseDate("2025-01-04")).toBe("2025-01-04");
    expect(parseAmount("1 234,56")).toBeCloseTo(1234.56);
    expect(parseAmount("1234.56")).toBeCloseTo(1234.56);
    expect(parseAmount("1.234,56")).toBeCloseTo(1234.56);
  });

  it("détecte doublons, dates futures, montants négatifs", () => {
    const m = { idAgence: 0, idResa: 1, date: 2, statut: 3, origine: 4, total: 5, erreurResalive: 6 };
    const r = rowsToDossiers([
      ["A1", "1", "01/01/2026", "Devis", "Commande", "10", "Non"],
      ["A1", "1", "01/01/2026", "Validée", "Commande", "10", "Non"],
      ["A1", "2", "01/01/2030", "Devis", "Commande", "-5", "Non"],
      ["A1", "", "01/01/2026", "Devis", "Commande", "1", "Non"],
    ], m, "2026-10-16");
    expect(r.dossiers).toHaveLength(2);
    expect(r.dossiers[0].statut).toBe("Validée");
    expect(r.anomalies.doublons).toEqual(["1"]);
    expect(r.anomalies.datesFutures).toEqual(["2"]);
    expect(r.anomalies.montantsNegatifs).toEqual(["2"]);
    expect(r.anomalies.lignesIgnorees).toHaveLength(1);
  });

  it("lit l'extract du lundi fourni (cumulatif depuis le 01/01/2025)", async () => {
    const r = await loadFixture("export_2026-10-05.csv");
    expect(r.dossiers).toHaveLength(31475);
    expect(r.periode).toEqual({ debut: "2025-01-01", fin: "2026-10-05" });
    expect(r.anomalies.lignesIgnorees).toHaveLength(0);
  });
});
