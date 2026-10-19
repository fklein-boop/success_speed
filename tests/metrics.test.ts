import { describe, it, expect, beforeAll } from "vitest";
import { computePortfolio, type ClientMetrics } from "@/lib/metrics/compute";
import { loadFixture, reference } from "./helpers";

/**
 * Recette de non-régression : les calculs sur l'export du 12/10/2026 doivent retrouver
 * les valeurs de 04_clients.json (±1 point de santé, ±1 € sur les volumes).
 */
describe("Recette de non-régression — export au 12/10/2026", () => {
  let ref: string | null;
  let metrics: ClientMetrics[];

  beforeAll(async () => {
    const { dossiers } = await loadFixture("export_2026-10-12.csv");
    const clients = reference.clients.map((c) => ({ id: c.id, vaGlobalEstime: c.va_global_estime }));
    ({ reference: ref, metrics } = computePortfolio(clients, dossiers));
  });

  it("date de référence = dossier le plus récent", () => {
    expect(ref).toBe("2026-10-12");
  });

  const euros = ["volume_12m", "va_confirme_12m", "volume_90j", "volume_90j_n1", "volume_ytd", "volume_ytd_n1"];
  const ratios = ["evol_90j", "evol_30j_vs_3m", "transformation", "taux_erreur_resalive", "taux_annulation", "part_captee"];
  const sous = ["s_dynamique", "s_activite", "s_usage", "s_qualite"];
  const exacts = ["dossiers_12m", "confirmes_12m", "jours_sans_dossier", "dernier_dossier", "segment", "risque", "usage", "alerte_principale"];

  for (const c of reference.clients) {
    it(`${c.id} — ${c.client}`, () => {
      const m = metrics.find((x) => x.id === c.id)! as unknown as Record<string, any>;
      expect(Math.abs(m.sante - c.sante), "score santé").toBeLessThanOrEqual(1);
      for (const f of euros) expect(Math.abs(m[f] - c[f]), f).toBeLessThanOrEqual(1);
      for (const f of ratios) {
        if (c[f] === null) expect(m[f], f).toBeNull();
        else expect(Math.abs(m[f] - c[f]), f).toBeLessThanOrEqual(0.0015);
      }
      for (const f of sous) expect(Math.abs(m[f] - c[f]), f).toBeLessThanOrEqual(0.1);
      for (const f of exacts) expect(m[f] ?? null, f).toEqual(c[f] ?? null);
      expect(m.alertes.length, "nb alertes").toBe(c.nb_alertes);
      expect(m.opportunites.length, "nb opportunités").toBe(c.nb_opportunites);
    });
  }
});
