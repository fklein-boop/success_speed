import { describe, it, expect } from "vitest";
import { compareAudits, computeScore, statutFromSeuil, statutMaturite, type CritereScore, type EvalScore, type Statut } from "@/lib/audit/score";

const C = (id: string, pilier: string, points: number, extra: Partial<CritereScore> = {}): CritereScore =>
  ({ id, pilier, points, type: "Oui/Non", sens: null, seuilPlein: null, seuilMoitie: null, ...extra });
const ev = (o: Record<string, Statut | null>) => new Map<string, EvalScore>(Object.entries(o).map(([k, v]) => [k, { statut: v }]));

describe("Score de maturité", () => {
  const crit = [C("A", "P1", 10), C("B", "P1", 10), C("C", "P2", 20, { obligationLegale: true }), C("D", "P2", 10), C("E", "P2", 50)];

  it("OUI 100 %, PARTIELLEMENT 50 %, NON 0, CORRIGÉ 0 (100 % après action), N.A. exclu", () => {
    const r = computeScore(crit, ev({ A: "OUI", B: "PARTIELLEMENT", C: "NON", D: "CORRIGÉ", E: "N.A." }));
    expect(r.pointsEvalues).toBe(50);
    expect(r.pointsObtenus).toBe(15);
    expect(r.score).toBe(30);
    expect(r.scoreApres).toBe(50);
    expect(r.nbApplicables).toBe(4);
    expect(r.couverture).toBe(1);
    expect(r.legauxNon).toEqual(["C"]);
    expect(r.piliers.find((p) => p.pilier === "P1")!.score).toBe(75);
  });

  it("couverture = évalués ÷ applicables ; fiable à partir de 70 %", () => {
    const r = computeScore(crit, ev({ A: "OUI", B: null }));
    expect(r.couverture).toBe(0.2);
    expect(r.fiable).toBe(false);
    expect(r.score).toBe(100);
  });

  it("aucun critère évalué : score nul", () => {
    expect(computeScore(crit, new Map()).score).toBeNull();
  });

  it("niveaux de maturité : < 35 faible, 35–72 intermédiaire, ≥ 73 avancée", () => {
    expect(statutMaturite(34.9)).toBe("faible");
    expect(statutMaturite(35)).toBe("intermediaire");
    expect(statutMaturite(72.9)).toBe("intermediaire");
    expect(statutMaturite(73)).toBe("avancee");
  });

  it("critères à seuil, dans les deux sens", () => {
    const haut = { sens: "↑", seuilPlein: 0.4, seuilMoitie: 0.2 };
    expect(statutFromSeuil(0.45, haut)).toBe("OUI");
    expect(statutFromSeuil(0.2, haut)).toBe("PARTIELLEMENT");
    expect(statutFromSeuil(0.1, haut)).toBe("NON");
    const bas = { sens: "↓", seuilPlein: 0.02, seuilMoitie: 0.05 };
    expect(statutFromSeuil(0.01, bas)).toBe("OUI");
    expect(statutFromSeuil(0.04, bas)).toBe("PARTIELLEMENT");
    expect(statutFromSeuil(0.08, bas)).toBe("NON");
    expect(statutFromSeuil(null, bas)).toBeNull();
  });

  it("critères gagnés et perdus entre deux audits", () => {
    const r = compareAudits(ev({ A: "NON", B: "OUI", C: "PARTIELLEMENT", D: null }), ev({ A: "OUI", B: "NON", C: "PARTIELLEMENT", D: "OUI" }));
    expect(r).toEqual({ gagnes: ["A"], perdus: ["B"] });
  });
});
