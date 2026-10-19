import { describe, it, expect } from "vitest";
import { buildAuditCsv, cell, nomFichier, type ExportCritere } from "@/lib/audit/export-csv";
import { computeScore } from "@/lib/audit/score";

const crit: ExportCritere[] = [
  { id: "LEG-01", pilier: "Conformité légale", critere: "Mentions légales complètes", points: 10, obligationLegale: true, offreSiNon: "Pack conformité", unite: null, sens: null, seuilPlein: null, seuilMoitie: null, source: "Auto (scan)" },
  { id: "PERF-12", pilier: "Performance web & conversion", critere: "Transformation ; devis \"confirmés\"", points: 8, obligationLegale: false, offreSiNon: "Paiement en ligne", unite: "%", sens: "↑", seuilPlein: 0.4, seuilMoitie: 0.2, source: "Données Speedmedia" },
  { id: "VIS-02", pilier: "Visibilité", critere: "Note Google", points: 8, obligationLegale: false, offreSiNon: null, unite: "note /5", sens: "↑", seuilPlein: 4.3, seuilMoitie: 4, source: "Auto (scan)" },
];
const evs = [
  { critereId: "LEG-01", statut: "NON" as const, valeur: null, commentaire: "Commentaire interne confidentiel", source: "csm", confiance: null, aEnvoyerClient: false, proposition: null, preuve: null, auteur: "Alice", updatedAt: "2026-10-16T10:00:00Z" },
  { critereId: "PERF-12", statut: "PARTIELLEMENT" as const, valeur: "0.335", commentaire: null, source: "donnees", confiance: "haute", aEnvoyerClient: false, proposition: { statut: "PARTIELLEMENT" as const, valeur: 0.335 }, preuve: { texte: "53 confirmés", source: "Export", periode: "12 mois" }, auteur: "Alice", updatedAt: "2026-10-16T10:00:00Z" },
];
const score = computeScore(crit.map((c) => ({ ...c, type: c.unite ? "Seuil" : "Oui/Non" })), new Map(evs.map((e) => [e.critereId, { statut: e.statut }])));
const base = { client: { id: "S25", nom: "Sourires du monde" }, audit: { date: "2026-10-16", statut: "finalise", urlAuditee: "https://www.souriresdumonde.com/", mention: null }, csm: "Alice", score, criteres: crit, evaluations: evs };

describe("Export CSV de l'audit", () => {
  it("format Excel français : BOM, point-virgule, dates JJ/MM/AAAA, décimales à virgule", () => {
    const { content, filename } = buildAuditCsv({ ...base, version: "client" });
    expect(content.startsWith("﻿")).toBe(true);
    expect(content).toContain("Date;16/10/2026");
    expect(content).toContain("Score de maturité (/100);22,2");
    expect(filename).toBe("Audit-SpeedResa_Sourires-du-monde_audit-final_2026-10-16.csv");
    expect(content).toContain('"Transformation ; devis ""confirmés"""');
  });

  it("version client : ni commentaire interne, ni chiffres de vente, ni confiance", () => {
    const { content } = buildAuditCsv({ ...base, version: "client", interne: { sante: 57, risque: "Critique", alertes: ["churn"] } });
    expect(content).not.toContain("confidentiel");
    expect(content).not.toContain("33,5");
    expect(content).not.toContain("Score santé");
    expect(content).not.toContain("Confiance");
    expect(content).toContain("Non vérifié");
    expect(content).toMatch(/Mentions légales complètes;NON;;Point non conforme à une obligation légale\.;Nous recommandons : Pack conformité\.;haute;oui;Pack conformité/);
  });

  it("version interne : preuves, auteurs, score santé", () => {
    const { content } = buildAuditCsv({ ...base, version: "interne", interne: { sante: 57, risque: "Critique", alertes: ["Baisse"] } });
    expect(content).toContain("Commentaire interne confidentiel");
    expect(content).toContain("33,5 %");
    expect(content).toContain("Score santé (interne);57");
    expect(content).toContain("Alice");
  });

  it("pré-audit : nom de fichier et mention", () => {
    const { content, filename } = buildAuditCsv({ ...base, version: "client", audit: { ...base.audit, statut: "brouillon" } });
    expect(filename).toContain("_pre-audit_");
    expect(content).toContain("Pré-audit automatique (à confirmer)");
  });

  it("neutralise les formules", () => {
    expect(cell("=SOMME(A1)")).toBe("'=SOMME(A1)");
    expect(cell("-59 %")).toBe("-59 %");
    expect(cell("@x")).toBe("'@x");
    expect(nomFichier("Ollandini Voyages / Corse", "pre-audit", "2026-10-16")).toBe("Audit-SpeedResa_Ollandini-Voyages-Corse_pre-audit_2026-10-16.csv");
  });
});
