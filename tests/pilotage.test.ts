import { describe, it, expect, beforeAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { alertes, audits, clients, clientSnapshots, clientUrls, disponibiliteMesures, envoisClient, evaluations, questionnaires, rdv, scanRuns, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { createAudit, finaliserAudit, importAuditsV1, loadCriteres, saveEvaluation } from "@/lib/server/audits";
import { recomputeAll } from "@/lib/server/recompute";
import { aFaire, benchmark, durees, opportunites } from "@/lib/server/pilotage";
import { creerCritere, ecrireParametre, empreintes, referencesLegales, tousCriteres, versionnerCritere } from "@/lib/server/parametres";
import { planifierRescanMensuel } from "@/lib/server/scans";
import { csvPortefeuille } from "@/lib/server/export-portefeuille";
import { sendWeeklyEmail } from "@/lib/server/weekly-email";
import { GROUPES_PARAMS } from "@/lib/metrics/libelles";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";
delete process.env.RESEND_API_KEY;

describe("Pilotage et administration", () => {
  let db: DB, admin: number, csm: number;

  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    await importAuditsV1(db);
    [{ id: admin }] = await db.insert(users).values({ email: "admin@test", role: "superadmin" }).returning();
    [{ id: csm }] = await db.insert(users).values({ email: "csm@test", nom: "Camille", role: "csm" }).returning();
  });

  it("chaque paramètre de calcul modifiable existe dans les valeurs par défaut", () => {
    for (const g of GROUPES_PARAMS) for (const [k] of g.params) {
      const v = g.cle ? (DEFAULT_METRICS_PARAMS as unknown as Record<string, Record<string, number>>)[g.cle][k] : (DEFAULT_METRICS_PARAMS as unknown as Record<string, number>)[k];
      expect(typeof v, `${g.cle}.${k}`).toBe("number");
    }
  });

  it("critères versionnés : une modification crée une version, les audits passés gardent la leur", async () => {
    const [ev] = await db.select().from(evaluations).where(eq(evaluations.critereId, "VIS-02")).limit(1);
    const r = await versionnerCritere(db, "VIS-02", { points: 12, seuilPlein: 4.5 }, admin);
    expect(r).toEqual({ version: 2, inchange: false });
    expect((await versionnerCritere(db, "VIS-02", { points: 12 }, admin)).inchange).toBe(true);
    const c = (await loadCriteres(db)).find((x) => x.id === "VIS-02")!;
    expect(c).toMatchObject({ version: 2, points: 12, seuilPlein: 4.5 });
    if (ev) expect((await db.select().from(evaluations).where(eq(evaluations.id, ev.id)))[0].critereVersion).toBe(1);
    await expect(versionnerCritere(db, "VIS-02", { seuilPlein: null }, admin)).rejects.toThrow(/seuil/);
    // Désactivation : absent des audits, visible dans l'administration
    await versionnerCritere(db, "INN-04", { actif: false }, admin);
    expect((await loadCriteres(db)).some((x) => x.id === "INN-04")).toBe(false);
    expect((await tousCriteres(db)).find((x) => x.id === "INN-04")?.actif).toBe(false);
    await expect(creerCritere(db, { id: "vis09", pilier: "x", critere: "x", commentVerifier: null, source: "CSM", type: "Oui/Non", sens: null, seuilPlein: null, seuilMoitie: null, unite: null, points: 5, obligationLegale: false, offreSiNon: null, questionClient: null }, admin)).rejects.toThrow(/format/);
    await creerCritere(db, { id: "VIS-09", pilier: "Visibilité & présence en ligne", critere: "Présence sur les comparateurs de voyages", commentVerifier: null, source: "CSM", type: "Oui/Non", sens: null, seuilPlein: null, seuilMoitie: null, unite: null, points: 5, obligationLegale: false, offreSiNon: null, questionClient: null }, admin);
    expect((await loadCriteres(db)).find((x) => x.id === "VIS-09")?.version).toBe(1);
  });

  it("paramètres surchargeables : empreintes et références légales", async () => {
    expect((await empreintes(db)).speedresa.length).toBeGreaterThan(0);
    await ecrireParametre(db, "empreintes", { a_valider: false, speedresa: [{ nom: "Test", motif: "/module-test/", force: "forte" }], concurrents: [] }, admin);
    expect((await empreintes(db)).speedresa[0].motif).toBe("/module-test/");
    await ecrireParametre(db, "references_legales", { "LEG-05": "Texte validé par le juridique." }, admin);
    const refs = await referencesLegales(db);
    expect(refs["LEG-05"]).toBe("Texte validé par le juridique.");
    expect(refs["LEG-02"]).toContain("R211-2");
  });

  it("alerte « site inaccessible » après 4 échecs consécutifs, close au retour du site", async () => {
    const t = (min: number) => new Date(Date.now() - min * 60_000);
    await db.insert(disponibiliteMesures).values([60, 45, 30, 15].map((m) => ({ clientId: "S25", url: "https://www.souriresdumonde.com/", ok: false, statutHttp: 503, erreur: "HTTP 503", at: t(m) })));
    await recomputeAll(db);
    const ouverte = await db.select().from(alertes).where(and(eq(alertes.clientId, "S25"), eq(alertes.code, "site_indisponible"), isNull(alertes.closeLe)));
    expect(ouverte).toHaveLength(1);
    expect(ouverte[0]).toMatchObject({ niveau: "critique", source: "scan" });
    expect(ouverte[0].message).toContain("HTTP 503");
    const [snap] = await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "S25"));
    expect(snap.risque).toBe("Critique");
    await db.insert(disponibiliteMesures).values({ clientId: "S25", url: "https://www.souriresdumonde.com/", ok: true, statutHttp: 200, at: new Date() });
    await recomputeAll(db);
    expect(await db.select().from(alertes).where(and(eq(alertes.clientId, "S25"), eq(alertes.code, "site_indisponible"), isNull(alertes.closeLe)))).toHaveLength(0);
  });

  it("file « À faire cette semaine » : critiques sans RDV, questionnaires en attente, points légaux non communiqués", async () => {
    const critiques = (await db.select().from(clientSnapshots)).filter((s) => (s.data as ClientMetrics).risque === "Critique").map((s) => s.clientId);
    let f = await aFaire(db, null);
    expect(f.critiquesSansRdv.map((c) => c.id).sort()).toEqual(critiques.sort());
    await db.insert(rdv).values({ clientId: critiques[0], date: new Date(Date.now() + 3 * 86_400_000), objet: "RDV", auteurId: csm });
    f = await aFaire(db, null);
    expect(f.critiquesSansRdv.some((c) => c.id === critiques[0])).toBe(false);

    // Point légal à NON dans un audit finalisé, pas encore envoyé au client
    const a = await createAudit(db, "C24", csm);
    await saveEvaluation(db, a.id, csm, { critereId: "LEG-05", statut: "NON", valeur: null, commentaire: null, aEnvoyerClient: false } as never);
    await finaliserAudit(db, a.id);
    await db.update(audits).set({ score: { ...(await db.select().from(audits).where(eq(audits.id, a.id)))[0].score as object, legauxNon: ["LEG-05"] } }).where(eq(audits.id, a.id));
    f = await aFaire(db, null);
    expect(f.legauxNonCommuniques.find((x) => x.id === "C24")?.criteres).toEqual(["LEG-05"]);
    await db.insert(envoisClient).values({ clientId: "C24", auditId: a.id, type: "restitution", destinataires: "x@y.fr", objet: "Audit", auteurId: csm });
    expect((await aFaire(db, null)).legauxNonCommuniques.some((x) => x.id === "C24")).toBe(false);

    await db.insert(questionnaires).values({ auditId: a.id, clientId: "C24", tokenHash: "h-test", email: "x@y.fr", questions: [], statut: "en_attente", expireLe: new Date(Date.now() + 20 * 86_400_000), envoyeLe: new Date(Date.now() - 5 * 86_400_000) });
    expect((await aFaire(db, null)).questionnairesEnAttente.map((q) => q.id)).toContain("C24");
    // Un CSM ne voit que ses clients
    expect(await aFaire(db, csm)).toEqual({ critiquesSansRdv: [], auditsARelancer: [], questionnairesEnAttente: [], legauxNonCommuniques: [] });
    await db.update(clients).set({ csmId: csm }).where(eq(clients.id, "C24"));
    expect((await aFaire(db, csm)).questionnairesEnAttente).toHaveLength(1);
  });

  it("benchmark, opportunités et durées", async () => {
    const b = await benchmark(db);
    expect(b.nbAudits).toBe(2); // dernier audit finalisé de chaque client : S25 et C24
    expect(b.nuage.length).toBeGreaterThan(0);
    expect(b.parCritere.find((c) => c.id === "LEG-05")).toBeTruthy();
    const o = await opportunites(db);
    expect(o.some((x) => x.source === "données")).toBe(true);
    const d = await durees(db);
    expect(d.completion.n).toBeGreaterThanOrEqual(0);
    expect(d.preAudit.mediane).toBeNull();
  });

  it("rescan mensuel : un scan léger en file par site principal, sans doublon", async () => {
    const sites = await db.select().from(clientUrls).where(eq(clientUrls.principale, true));
    const r1 = await planifierRescanMensuel(db);
    expect(r1.crees + r1.ignores).toBe(sites.length);
    expect(r1.crees).toBeGreaterThan(50);
    const r2 = await planifierRescanMensuel(db);
    expect(r2.crees).toBe(0);
    const file = await db.select().from(scanRuns).where(and(eq(scanRuns.type, "leger"), eq(scanRuns.statut, "en_attente")));
    expect(file).toHaveLength(r1.crees);
    expect(file.every((s) => s.auditId === null && s.demandePar === null)).toBe(true);
  });

  it("export CSV du portefeuille (format Excel français)", async () => {
    const { filename, content } = await csvPortefeuille(db);
    expect(filename).toMatch(/^Portefeuille-SpeedResa_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(content.startsWith("﻿")).toBe(true);
    const lignes = content.trim().split("\r\n");
    expect(lignes[0]).toContain("Score santé;");
    expect(lignes.length - 1).toBe((await db.select().from(clients).where(eq(clients.actif, true))).length);
    expect(lignes.find((l) => l.startsWith("S25;"))).toMatch(/Sourires du monde/);
  });

  it("email du lundi : partie commune et file personnelle de chaque destinataire", async () => {
    const r = await sendWeeklyEmail(db, { reference: "2026-10-12", nouveauxCritiques: [], reprises: [], chutes: [] });
    expect(r.ok).toBe(true);
  });
});
