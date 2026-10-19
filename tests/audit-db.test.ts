import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { audits, clientSnapshots, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, applyImport } from "@/lib/server/imports";
import { createAudit, finaliserAudit, getAuditState, importAuditsV1, saveEvaluation, validerPropositions, AuditError } from "@/lib/server/audits";
import { recomputeAll } from "@/lib/server/recompute";
import type { ClientMetrics } from "@/lib/metrics/compute";
import { loadFixture } from "./helpers";

process.env.PGLITE_DIR = "memory";

describe("Audit : création, complétion, finalisation", () => {
  let db: DB;
  let alice: number, bob: number, auditId: number;

  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    const r = await loadFixture("export_2026-10-12.csv");
    const imp = await createImport(db, null, { fichier: "x.csv", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null);
    [{ id: alice }] = await db.insert(users).values({ email: "alice@test", role: "csm" }).onConflictDoNothing().returning();
    [{ id: bob }] = await db.insert(users).values({ email: "bob@test", role: "csm" }).onConflictDoNothing().returning();
  });

  it("importe les deux audits de l'ancienne grille (Sourires du monde daté, Cannelle avec mention)", async () => {
    expect(await importAuditsV1(db)).toBe(2);
    expect(await importAuditsV1(db)).toBe(0);
    const list = await db.select().from(audits);
    const s25 = list.find((a) => a.clientId === "S25")!;
    expect(s25.date).toBe("2025-06-18");
    expect((s25.score as { nbEvalues: number }).nbEvalues).toBe(12);
    const c24 = list.find((a) => a.clientId === "C24")!;
    expect(c24.mention).toMatch(/Date d'origine inconnue/);
    expect((c24.score as { nbEvalues: number }).nbEvalues).toBe(34);
  });

  it("un nouvel audit est pré-rempli avec les critères calculés sur les données", async () => {
    const r = await createAudit(db, "S25", alice);
    auditId = r.id;
    expect(r.existant).toBe(false);
    expect((await createAudit(db, "S25", bob)).id).toBe(auditId); // le brouillon en cours est rouvert
    const st = await getAuditState(db, auditId);
    const props = Object.fromEntries(st.evaluations.map((e) => [e.critereId, e.proposition as { statut: string | null }]));
    // Transformation 33,5 % : seuil plein 40 %, moitié 20 % → PARTIELLEMENT
    expect(props["PERF-12"].statut).toBe("PARTIELLEMENT");
    // Volume 90 j −59 % : seuils 0 / −10 % → NON
    expect(props["PERF-06"].statut).toBe("NON");
    expect(st.evaluations.every((e) => e.statut === null)).toBe(true);
    expect(st.precedent?.audit.date).toBe("2025-06-18");
  });

  it("valider les résultats sûrs remplit les statuts", async () => {
    const { valides, score } = await validerPropositions(db, auditId, alice);
    expect(valides).toContain("PERF-12");
    // RES-05 passe en N.A. (aucun dossier RésaLive) : non compté parmi les critères évalués
    expect(valides).toContain("RES-05");
    expect(score.nbEvalues).toBe(valides.length - 1);
  });

  it("contredire un résultat automatique exige un commentaire", async () => {
    const base = { valeur: null, aEnvoyerClient: false, base: null };
    await expect(saveEvaluation(db, auditId, alice, { ...base, critereId: "PERF-06", statut: "OUI", commentaire: null }))
      .rejects.toThrow(/contredisez/);
    const r = await saveEvaluation(db, auditId, alice, { ...base, critereId: "PERF-06", statut: "OUI", commentaire: "Effet de calendrier" });
    expect(r.evaluation.statut).toBe("OUI");
  });

  it("une valeur saisie calcule le statut ; un autre statut exige un commentaire", async () => {
    await expect(saveEvaluation(db, auditId, alice, { critereId: "VIS-02", statut: "OUI", valeur: 3.9, commentaire: null, aEnvoyerClient: false, base: null }))
      .rejects.toThrow(/donne « NON »/);
    const r = await saveEvaluation(db, auditId, alice, { critereId: "VIS-02", statut: "NON", valeur: 3.9, commentaire: null, aEnvoyerClient: false, base: null });
    expect(r.evaluation.valeur).toBe("3.9");
  });

  it("deux CSM sur le même critère ne s'écrasent pas", async () => {
    const vu = new Date(Date.now() - 60_000).toISOString();
    await saveEvaluation(db, auditId, alice, { critereId: "LEG-01", statut: "NON", valeur: null, commentaire: null, aEnvoyerClient: false, base: null });
    const err = await saveEvaluation(db, auditId, bob, { critereId: "LEG-01", statut: "OUI", valeur: null, commentaire: null, aEnvoyerClient: false, base: vu }).catch((e) => e);
    expect(err).toBeInstanceOf(AuditError);
    expect(err.status).toBe(409);
    const forced = await saveEvaluation(db, auditId, bob, { critereId: "LEG-01", statut: "NON", valeur: null, commentaire: null, aEnvoyerClient: false, base: vu, force: true });
    expect(forced.evaluation.auteurId).toBe(bob);
  });

  it("finaliser un audit avec un critère légal à NON lève une alerte « À surveiller »", async () => {
    await finaliserAudit(db, auditId);
    await recomputeAll(db);
    const [snap] = await db.select().from(clientSnapshots).where(eq(clientSnapshots.clientId, "S25"));
    const m = snap.data as ClientMetrics;
    expect(m.alertes.some((a) => a.code === "legal_non" && a.message.includes("LEG-01"))).toBe(true);
    await expect(saveEvaluation(db, auditId, alice, { critereId: "VIS-01", statut: "OUI", valeur: null, commentaire: null, aEnvoyerClient: false, base: null }))
      .rejects.toThrow(/finalisé/);
  });
});
