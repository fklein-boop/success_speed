import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { clients, clientUrls, scanResults, scanRuns, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { causeNonVerifiable, criteresPlateforme, lancerCampagneFiabilite, marquerPlateforme, rapportFiabilite, csvFiabilite } from "@/lib/server/fiabilite";
import { loadCriteres, scoreAudit } from "@/lib/server/audits";
import { DETECTEURS } from "@/scan/registry";

process.env.PGLITE_DIR = "memory";
process.env.SCAN_AUTORISER_LOCAL = "1";

describe("Lot E — causes des « non vérifiable »", () => {
  it("classe les messages des contrôles", () => {
    expect(causeNonVerifiable("Clé Google Places manquante — à renseigner dans Administration", "navigateur")).toBe("clé d'API manquante");
    expect(causeNonVerifiable("Clé Anthropic non configurée : visibilité…", "http")).toBe("clé d'API manquante");
    expect(causeNonVerifiable("Parcours automatique du tunnel désactivé (SCAN_TUNNEL) : assurance à vérifier", "navigateur")).toBe("tunnel désactivé");
    expect(causeNonVerifiable("Parcours du tunnel impossible sans navigateur : à vérifier par le CSM.", "http")).toBe("site sans navigateur");
    expect(causeNonVerifiable("Fiche Google Business Profile introuvable : à identifier", "navigateur")).toBe("page ou fiche introuvable");
    expect(causeNonVerifiable("PageSpeed Insights indisponible : Quota PageSpeed atteint", "navigateur")).toBe("erreur d'un service externe");
    expect(causeNonVerifiable("Monitoring de disponibilité pas encore démarré pour ce site", "navigateur")).toBe("monitoring non démarré");
    expect(causeNonVerifiable("Top ventes indisponible (aucun nom de voyage dans les dossiers importés)", "navigateur")).toBe("donnée interne manquante");
  });
});

describe("Lot E — campagne, rapport, critères plateforme (base)", () => {
  let db: DB, admin: number;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    [{ id: admin }] = await db.insert(users).values({ email: "admin-lot-e@test", role: "superadmin" }).returning();
  });

  it("met en file un pré-audit « fiabilité » par site, sans créer d'audit", async () => {
    const r = await lancerCampagneFiabilite(db, admin);
    const runs = await db.select().from(scanRuns).where(eq(scanRuns.type, "fiabilite"));
    expect(runs.length).toBe(r.crees);
    expect(r.crees + r.refus.length).toBe(r.sites);
    expect(runs.every((x) => x.auditId === null)).toBe(true);
  });

  it("rapport : répartition, causes, critère plateforme proposé quand ≥ 90 % des sites ont le même résultat", async () => {
    const runs = (await db.select().from(scanRuns).where(eq(scanRuns.type, "fiabilite"))).slice(0, 12);
    for (const [i, run] of runs.entries()) {
      await db.update(scanRuns).set({ statut: "termine", mode: "navigateur", fin: new Date() }).where(eq(scanRuns.id, run.id));
      await db.delete(scanResults).where(eq(scanResults.scanRunId, run.id));
      await db.insert(scanResults).values([
        { scanRunId: run.id, critereId: "VIS-08", etat: "ko", statutPropose: "NON", confiance: "haute", texte: "Aucune donnée structurée" },
        { scanRunId: run.id, critereId: "TECH-01", etat: i % 2 ? "ok" : "ko", statutPropose: i % 2 ? "OUI" : "NON", confiance: "haute", texte: "" },
        { scanRunId: run.id, critereId: "VIS-02", etat: "non_verifiable", statutPropose: null, confiance: "basse", texte: "Clé Google Places manquante — à renseigner dans Administration (État des services)." },
      ]);
    }
    const r = await rapportFiabilite(db);
    expect(r.sitesAnalyses).toBe(12);
    const l = (id: string) => r.lignes.find((x) => x.critereId === id)!;
    expect(l("VIS-08")).toMatchObject({ non: 12, plateformeProposee: true, dominant: "NON", partDominant: 1, confianceMoyenne: 1 });
    expect(l("TECH-01")).toMatchObject({ oui: 6, non: 6, plateformeProposee: false });
    expect(l("VIS-02")).toMatchObject({ nonVerifiable: 12, causePrincipale: "clé d'API manquante", verifiable: 0 });
    expect(r.chantiersProduit).toEqual([{ critereId: "VIS-08", critere: expect.any(String), clients: 12, sur: 12 }]);
    expect(r.lignes).toHaveLength(DETECTEURS.length);
    const csv = await csvFiabilite(db);
    expect(csv.split("\r\n")[0]).toMatch(/^﻿Critère;Libellé;Pilier;Sites;OUI/);
    expect(csv).toMatch(/VIS-08;.*;12;0;0;12;0;0;100;100;;NON;100;oui;non/);
  });

  it("un critère marqué « Plateforme » reste affiché mais ne compte plus dans le score", async () => {
    const avant = scoreAudit(await loadCriteres(db), [{ critereId: "VIS-08", statut: "NON" }, { critereId: "TECH-01", statut: "OUI" }]);
    await marquerPlateforme(db, admin, "VIS-08", true);
    expect(await criteresPlateforme(db)).toEqual(["VIS-08"]);
    const cs = await loadCriteres(db);
    expect(cs.find((c) => c.id === "VIS-08")).toMatchObject({ points: 0, plateforme: true });
    const apres = scoreAudit(cs, [{ critereId: "VIS-08", statut: "NON" }, { critereId: "TECH-01", statut: "OUI" }]);
    expect(avant.score).toBeLessThan(100);
    expect(apres.score).toBe(100);
    await marquerPlateforme(db, admin, "VIS-08", false);
    expect((await loadCriteres(db)).find((c) => c.id === "VIS-08")?.plateforme).toBeUndefined();
  });
});
