/**
 * Répartition par défaut des critères restants entre le CSM et le client (lot B2, retours du 22/10/2026).
 * Le CSM peut changer chaque choix avant de générer le lien du questionnaire.
 */
export type Repondant = "csm" | "client";

const CLIENT = new Set(["VIS-05", "VIS-06", "PROD-01", "LEG-09", "LEG-10", "LEG-11", "TRK-05", "INN-03"]);
const CSM = new Set(["PERF-02", "PERF-09", "DIST-02", "INN-04", "VIS-04", "VIS-03"]);
/** CSM d'abord, puis client si le CSM ne sait pas (tant que l'export catalogue n'est pas là) */
const CSM_PUIS_CLIENT = new Set(["PROD-02", "PROD-05", "PROD-06", "PROD-07"]);

export function repartitionParDefaut(c: { id: string; source: string }, catalogueDisponible: boolean): { qui: Repondant; note?: string } {
  if (c.id === "VIS-05") return { qui: "client", note: "après une première vérification par le CSM (pages sociales)" };
  if (CLIENT.has(c.id)) return { qui: "client" };
  if (CSM.has(c.id)) return { qui: "csm" };
  if (CSM_PUIS_CLIENT.has(c.id) && !catalogueDisponible) return { qui: "csm", note: "passez-le au client si vous ne savez pas" };
  return { qui: /Client/.test(c.source) ? "client" : "csm" };
}
