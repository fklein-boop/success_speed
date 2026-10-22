import { describe, it, expect, beforeAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { audits, clients, criteres, users } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createAudit, loadCriteres, saveEvaluation, getAuditState } from "@/lib/server/audits";
import { nettoyageLotD } from "@/lib/server/referentiel";
import type { ScoreResult } from "@/lib/audit/score";

process.env.PGLITE_DIR = "memory";

describe("Lot D — nettoyage du référentiel", () => {
  let db: DB, csm: number, auditId: number, scoreAvant: number | null;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
    [{ id: csm }] = await db.insert(users).values({ email: "csm-lot-d@test", role: "csm" }).returning();
    auditId = (await createAudit(db, "P17", csm)).id;
    for (const [c, s, com] of [["REL-01", "NON", "pas de RDV"], ["REL-02", "NON", null], ["REL-03", "OUI", "Julie Martin, responsable web"], ["TECH-01", "OUI", null], ["LEG-01", "NON", "constat"]] as const)
      await saveEvaluation(db, auditId, csm, { critereId: c, statut: s, valeur: null, commentaire: com, aEnvoyerClient: false, base: null } as never);
    scoreAvant = ((await db.select().from(audits).where(eq(audits.id, auditId)))[0].score as ScoreResult).score;
  });

  it("retire REL-01, REL-02, SOC-05 et REL-03 par une nouvelle version inactive ; le pilier « Relation client » disparaît", async () => {
    const r = await nettoyageLotD(db, new Date("2026-10-22T10:00:00Z"));
    expect(r?.retires.sort()).toEqual(["REL-01", "REL-02", "REL-03", "SOC-05"]);
    const actifs = await loadCriteres(db);
    expect(actifs.some((c) => ["REL-01", "REL-02", "REL-03", "SOC-05"].includes(c.id))).toBe(false);
    expect(actifs.some((c) => c.pilier === "Relation client")).toBe(false);
    expect(actifs).toHaveLength(73);
    const versions = await db.select().from(criteres).where(eq(criteres.id, "REL-01"));
    expect(versions.map((v) => [v.version, v.actif]).sort()).toEqual([[1, true], [2, false]]);
  });

  it("score recalculé sur le référentiel actif, mention dans l'historique ; audit toujours lisible", async () => {
    const [a] = await db.select().from(audits).where(eq(audits.id, auditId));
    const s = a.score as ScoreResult;
    expect(s.piliers.some((p) => p.pilier === "Relation client")).toBe(false);
    expect(s.score).not.toBe(scoreAvant);
    expect(a.mention).toMatch(/Score recalculé le 22\/10\/2026 sur le référentiel actif \(.*REL-01.*\)/);
    const st = await getAuditState(db, auditId);
    expect(st.criteres.some((c) => c.id === "REL-01")).toBe(false);
    expect(st.evaluations.some((e) => e.critereId === "REL-01")).toBe(true); // réponse conservée
  });

  it("REL-03 devient l'interlocuteur digital de la fiche client ; nettoyage appliqué une seule fois", async () => {
    const [c] = await db.select().from(clients).where(eq(clients.id, "P17"));
    expect(c.interlocuteurDigital).toBe("Julie Martin, responsable web");
    // Réactivation par l'administration : un nouveau déploiement ne la défait pas
    const [d] = await db.select().from(criteres).where(and(eq(criteres.id, "SOC-05"), eq(criteres.version, 2)));
    await db.insert(criteres).values({ ...d, version: 3, actif: true, createdAt: undefined as never });
    expect(await nettoyageLotD(db)).toBeNull();
    expect((await loadCriteres(db)).some((x) => x.id === "SOC-05")).toBe(true);
  });
});
