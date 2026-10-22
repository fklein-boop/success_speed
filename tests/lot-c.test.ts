import { describe, it, expect, beforeAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { actions, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { createAudit, saveEvaluation } from "@/lib/server/audits";
import { feuilleParRegles, libelleEcheance, nettoyerChantiers, syntheseParRegles, type Chantier } from "@/lib/restitution/feuille";
import type { ActionProposee } from "@/lib/restitution/plan";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";

// Claude simulé : activé par test, renvoie une proposition à contrôler
const ia = vi.hoisted(() => ({ actif: false, reponse: null as unknown }));
vi.mock("@/scan/ia", async (orig) => ({ ...(await orig<typeof import("@/scan/ia")>()), iaDisponible: () => ia.actif, analyserIa: async () => ia.reponse }));
const { proposerFeuille, enregistrerFeuille, validerFeuille, feuillesClient, majSuiviChantier } = await import("@/lib/server/feuille");
const { chargerRestitution, modeleClient, pdfClient } = await import("@/lib/server/restitution");

const A = (critereId: string, pilier: string, priorite: number, x: Partial<ActionProposee> = {}): ActionProposee => ({ critereId, libelle: `Libellé ${critereId}`, pilier, offre: `Offre ${critereId}`, statutCritere: "NON", impact: 1, effort: "moyen", priorite, levier: null, obligationLegale: false, ...x });

describe("C1 — regroupement par règles (sans clé Anthropic)", () => {
  const items = [
    A("PROD-02", "Digitalisation de la production", 8), A("PROD-03", "Digitalisation de la production", 6),
    A("LEG-02", "Conformité légale", 3, { obligationLegale: true }), A("TRK-01", "Tracking & data", 9),
    A("PROD-06", "Digitalisation de la production", 5), A("VIS-02", "Visibilité & présence en ligne", 2),
    A("TECH-03", "Technique & sécurité", 1), A("INN-02", "Innovation", 1), A("DIST-01", "Distribution & marketplaces", 1),
  ];
  it("conformité légale en premier, 6 chantiers au plus, chaque critère une seule fois", () => {
    const c = feuilleParRegles(items, ["Équipe technique"], new Date("2026-10-22"));
    expect(c[0]).toMatchObject({ titre: "Mettre le site en conformité légale", priorite: "haute", debut: 0, echeance: "d'ici 30 jours" });
    expect(c.length).toBeLessThanOrEqual(6);
    const tous = c.flatMap((x) => x.criteres);
    expect(new Set(tous).size).toBe(tous.length);
    expect(c.find((x) => x.titre === "Développer les ventes additionnelles")?.criteres).toEqual(["PROD-06"]);
    expect(c.find((x) => x.titre === "Mesurer ses ventes en ligne")?.porteur).toEqual({ type: "equipe", nom: "Équipe technique" });
    expect(c.at(-1)!.priorite).toBe("basse");
  });
  it("échéances lisibles et synthèse en quelques lignes", () => {
    expect(libelleEcheance(0, 1, new Date("2026-10-22"))).toBe("d'ici 30 jours");
    expect(libelleEcheance(1, 2, new Date("2026-10-22"))).toBe("d'ici 3 mois");
    expect(libelleEcheance(3, 3, new Date("2026-10-22"))).toBe("T1 2027");
    const t = syntheseParRegles({ client: "Perier", score: 52, scoreVise: 71, preAudit: false, forces: ["HTTPS"] }, feuilleParRegles(items));
    expect(t).toMatch(/52\/100.*chantiers.*71\/100/s);
  });
  it("une proposition est contrôlée : critère inconnu ou en double retiré, obligation légale jamais oubliée", () => {
    const base: Chantier = { id: "x", titre: "Catalogue", objectif: "", benefice: "", criteres: ["PROD-02", "XXX-01", "PROD-02"], priorite: "moyenne", debut: 5, duree: 4, echeance: "", porteur: { type: "client", nom: null }, offre: null, suivi: "propose" };
    const r = nettoyerChantiers([base, { ...base, id: "y", criteres: ["XXX-02"] }], items);
    expect(r[0]).toMatchObject({ id: "legal", criteres: ["LEG-02"], priorite: "haute" });
    expect(r[1]).toMatchObject({ criteres: ["PROD-02"], debut: 5, duree: 1 });
    expect(r).toHaveLength(2);
  });
});

describe("C2 — feuille de route de bout en bout (base)", () => {
  let db: DB, csm: number;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: csm }] = await db.insert(users).values({ email: "csm-lot-c@test", role: "csm" }).returning();
    const { id } = await createAudit(db, "P17", csm);
    for (const [c, s] of [["LEG-01", "NON"], ["LEG-02", "PARTIELLEMENT"], ["PROD-02", "NON"], ["PROD-03", "NON"], ["TRK-01", "NON"], ["VIS-02", "PARTIELLEMENT"], ["PERF-13", "NON"], ["TECH-01", "OUI"]] as const)
      await saveEvaluation(db, id, csm, { critereId: c, statut: s, valeur: null, commentaire: s === "OUI" ? null : "constat", aEnvoyerClient: false, base: null } as never);
  });

  it("Claude propose : sa proposition est nettoyée et enregistrée en brouillon", async () => {
    ia.actif = true;
    ia.reponse = { synthese: "Votre site a de bonnes bases. Trois chantiers en six mois.", chantiers: [
      { titre: "Rendre le catalogue plus attractif", objectif: "Fiches complètes", benefice: "Plus de réservations", criteres: ["PROD-02", "prod-03", "INCONNU"], priorite: "haute", debut: 0, duree: 2, porteur: "client", porteurNom: null, offre: "Atelier catalogue" },
      { titre: "Mesurer ses ventes", objectif: "GA4", benefice: "Piloter", criteres: ["TRK-01"], priorite: "moyenne", debut: 1, duree: 2, porteur: "equipe", porteurNom: "Équipe inexistante", offre: null },
    ] };
    const r = await proposerFeuille(db, "P17", csm);
    expect(r.source).toBe("claude");
    const { courante } = await feuillesClient(db, "P17", null).then(async () => feuillesClient(db, "P17", (await chargerRestitution(db, "P17")).audit!.id));
    expect(courante?.statut).toBe("brouillon");
    const ch = courante!.chantiers;
    expect(ch.find((c) => /conformit/i.test(c.titre))?.criteres.sort()).toEqual(["LEG-01", "LEG-02"]);
    expect(ch.find((c) => c.titre.startsWith("Rendre"))?.criteres).toEqual(["PROD-02", "PROD-03"]);
    expect(ch.find((c) => c.titre.startsWith("Mesurer"))?.porteur).toEqual({ type: "equipe", nom: "Équipe technique" });
    ia.actif = false;
  });

  it("sans clé : regroupement par règles ; le CSM fusionne et réordonne ; validation = actions du plan + PDF", async () => {
    expect((await proposerFeuille(db, "P17", csm)).source).toBe("regles");
    const auditId = (await chargerRestitution(db, "P17")).audit!.id;
    const f = (await feuillesClient(db, "P17", auditId)).courante!;
    // Fusion des deux derniers chantiers, puis le dernier passe en tête
    const [premier, ...reste] = f.chantiers;
    const fusion = reste.length >= 2 ? [{ ...reste[0], criteres: [...reste[0].criteres, ...reste[1].criteres] }, ...reste.slice(2)] : reste;
    const ordre = [...fusion.reverse(), premier];
    await enregistrerFeuille(db, "P17", csm, { synthese: "Synthèse relue par le CSM.", chantiers: ordre });
    const v = await validerFeuille(db, "P17", csm);
    expect(v.actionsCreees).toBeGreaterThan(0);
    const acts = await db.select().from(actions).where(eq(actions.clientId, "P17"));
    expect(acts.every((a) => a.echeance)).toBe(true);
    const r = await chargerRestitution(db, "P17");
    const m = modeleClient(r as never);
    expect(m.synthese).toBe("Synthèse relue par le CSM.");
    expect(m.feuille?.chantiers[0].titre).toBe(ordre[0].titre);
    expect(JSON.stringify(m.feuille)).not.toMatch(/constat|csm-lot-c/);
    const pdf = await pdfClient(db, "P17");
    expect(pdf.buffer.length).toBeGreaterThan(5000);
    const id = (await feuillesClient(db, "P17", null)).validee!.chantiers[0].id;
    await majSuiviChantier(db, "P17", csm, id, "en_cours");
    expect((await feuillesClient(db, "P17", null)).validee!.chantiers[0].suivi).toBe("en_cours");
  }, 60000);
});
