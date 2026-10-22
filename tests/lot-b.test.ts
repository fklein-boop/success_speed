import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { evaluations, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { createAudit, saveEvaluation } from "@/lib/server/audits";
import { creerQuestionnaire } from "@/lib/server/questionnaires";
import { presentationClient } from "@/lib/server/presentation";
import { repartitionParDefaut } from "@/lib/audit/repartition";
import { GUIDES, lienGuide, statutComptage } from "@/lib/audit/guides";
import { chercherRelais, typeRelais } from "@/scan/relais";
import criteresKit from "../data/kit/03_criteres.json";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "secret-de-test-lot-b-suffisamment-long";

describe("B2 — répartition par défaut", () => {
  const c = (id: string) => ({ id, source: criteresKit.criteres.find((x) => x.id === id)!.source });
  it("suit le tableau des retours du 22/10", () => {
    for (const id of ["VIS-05", "VIS-06", "PROD-01", "LEG-09", "LEG-10", "LEG-11", "TRK-05", "INN-03"]) expect(repartitionParDefaut(c(id), false).qui, id).toBe("client");
    for (const id of ["PERF-02", "PERF-09", "DIST-02", "INN-04", "VIS-04", "VIS-03"]) expect(repartitionParDefaut(c(id), false).qui, id).toBe("csm");
    expect(repartitionParDefaut(c("PROD-02"), false)).toEqual({ qui: "csm", note: expect.stringMatching(/client si vous ne savez pas/) });
    expect(repartitionParDefaut(c("PROD-02"), true).note).toBeUndefined();
    expect(repartitionParDefaut(c("VIS-05"), false).note).toMatch(/première vérification/);
  });
});

describe("B3 — comment vérifier", () => {
  it("chaque critère manuel a un guide de 2 à 4 étapes (au moins 1 pour les critères purement déclaratifs)", () => {
    // Toujours calculés sur l'export dossiers (lot A1) : jamais posés à la main
    const toujoursCalcules = new Set(["PERF-05", "PERF-06", "PERF-12", "RES-04", "RES-05", "SOC-07"]);
    const manuels = criteresKit.criteres.filter((x) => !/^Auto \(scan\)$/.test(x.source) && !toujoursCalcules.has(x.id));
    const sans = manuels.filter((x) => !GUIDES[x.id]).map((x) => x.id);
    expect(sans).toEqual([]);
    for (const [id, g] of Object.entries(GUIDES)) expect(g.etapes.length, id).toBeLessThanOrEqual(4);
  });
  it("liens remplis avec le client ; lien omis si la fiche Google est inconnue", () => {
    const v = { site: "https://www.perier-voyages.fr/", domaine: "perier-voyages.fr", nom: "Perier Voyages", placeId: null };
    expect(lienGuide(GUIDES["VIS-04"].liens![0].url, v)).toBe("https://www.google.com/search?q=%22perier-voyages.fr%22+-site%3Aperier-voyages.fr");
    expect(lienGuide(GUIDES["VIS-03"].liens![0].url, v)).toBeNull();
    expect(lienGuide(GUIDES["VIS-03"].liens![0].url, { ...v, placeId: "ChIJ123" })).toContain("placeid=ChIJ123");
    expect(GUIDES["VIS-05"].definition).toMatch(/pas à la page d'accueil/);
    expect(GUIDES["LEG-10"].definition).toMatch(/1er septembre 2026/);
  });
  it("VIS-05 : 8 publications ou plus = OUI, 4 à 7 = PARTIELLEMENT, moins de 4 = NON", () => {
    const g = GUIDES["VIS-05"].comptage!;
    expect([9, 8, 7, 4, 3, 0].map((n) => statutComptage(g, n))).toEqual(["OUI", "OUI", "PARTIELLEMENT", "PARTIELLEMENT", "NON", "NON"]);
  });
  it("VIS-04 : pages trouvées par la recherche web, classées par type, hors site du client", async () => {
    expect(typeRelais("https://www.mairie-albi.fr/partenaires")).toBe("mairie");
    expect(typeRelais("https://cse-airbus.fr/voyages")).toBe("CSE");
    expect(typeRelais("https://www.albi-tourisme.fr/agences")).toBe("office de tourisme");
    expect(typeRelais("https://www.pagesjaunes.fr/pros/123")).toBe("annuaire");
    const faux = async (q: string) => ({ texte: q, sources: ["https://www.perier-voyages.fr/a", "https://www.mairie-albi.fr/partenaires", "https://www.facebook.com/perier", "https://cse-airbus.fr/voyages", "https://www.mairie-albi.fr/partenaires"] });
    const r = await chercherRelais("Perier Voyages", "perier-voyages.fr", faux);
    expect(r.map((x) => x.type)).toEqual(["mairie", "CSE", "réseau social"]);
    expect(r.some((x) => x.domaine === "perier-voyages.fr")).toBe(false);
  });
});

describe("B2 / B5 de bout en bout (base)", () => {
  let db: DB, csm: number, auditId: number;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: csm }] = await db.insert(users).values({ email: "csm-lot-b@test", role: "csm" }).returning();
    auditId = (await createAudit(db, "P17", csm)).id;
  });

  it("lien client limité aux questions choisies ; elles passent « envoyées au client »", async () => {
    const q = await creerQuestionnaire(db, auditId, csm, { envoyer: false, criteres: ["LEG-10", "VIS-06", "PERF-09"] });
    expect(q.questions).toBe(3);
    expect(q.lien).toMatch(/\/q\//);
    const ev = async (id: string) => (await db.select().from(evaluations).where(and(eq(evaluations.auditId, auditId), eq(evaluations.critereId, id))))[0];
    expect(await ev("PERF-09")).toMatchObject({ aEnvoyerClient: true, statut: null });
    expect((await ev("LEG-11"))?.aEnvoyerClient ?? false).toBe(false);
    await expect(creerQuestionnaire(db, auditId, csm, { envoyer: false, criteres: [] })).rejects.toThrow(/au moins une/);
    await expect(creerQuestionnaire(db, auditId, csm, { envoyer: false, criteres: ["XXX-99"] })).rejects.toThrow(/inconnu/);
  });

  it("présentation au client : par pilier, en place / manque / solution, sans aucune donnée interne", async () => {
    await saveEvaluation(db, auditId, csm, { critereId: "LEG-01", statut: "NON", valeur: null, commentaire: "Commentaire interne à ne jamais montrer", aEnvoyerClient: false, base: null } as never);
    await saveEvaluation(db, auditId, csm, { critereId: "TECH-01", statut: "OUI", valeur: null, commentaire: null, aEnvoyerClient: false, base: null } as never);
    const p = await presentationClient(db, "P17", auditId);
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/Commentaire interne|csm-lot-b/);
    expect(Object.keys(p).sort()).toEqual(["client", "date", "niveau", "piliers", "preAudit", "priorites", "score", "scoreVise", "synthese"]);
    expect(Object.keys(p.piliers[0]).sort()).toEqual(["enCours", "enPlace", "manque", "moyenne", "pilier", "score"]);
    const legal = p.piliers.find((x) => x.manque.some((m) => m.legal));
    expect(legal?.manque[0]).toMatchObject({ legal: true, solution: expect.any(String) });
    expect(p.piliers.some((x) => x.enPlace.length > 0)).toBe(true);
    await expect(presentationClient(db, "S30", auditId)).rejects.toThrow(/introuvable/);
  });
});
