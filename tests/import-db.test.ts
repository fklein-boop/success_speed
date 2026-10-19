import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { clientSnapshots, dossiers, imports } from "@/db/schema";
import { seedReferentiel } from "@/lib/seed";
import { createImport, addRows, previewImport, applyImport, undoLastImport } from "@/lib/server/imports";
import { loadFixture, reference } from "./helpers";

process.env.PGLITE_DIR = "memory";

async function runImport(db: DB, file: string, apply = true) {
  const r = await loadFixture(file);
  const imp = await createImport(db, null, { fichier: file, periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
  await addRows(db, imp.id, r.dossiers);
  const preview = await previewImport(db, imp.id);
  const res = apply ? await applyImport(db, imp.id, null) : null;
  return { preview, res };
}

describe("Import du lundi : fusion, recalcul, annulation", () => {
  let db: DB;
  beforeAll(async () => {
    db = await getDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
    await seedReferentiel(db);
  });

  it("premier import (extract du 05/10) : tous les dossiers sont nouveaux", async () => {
    const { preview } = await runImport(db, "export_2026-10-05.csv");
    expect(preview.type).toBe("premier");
    expect(preview.nouveaux).toBe(31475);
    expect(preview.agencesInconnues).toEqual([]); // D01 et D10 (démo) ne sont pas signalées
  });

  it("extract suivant (12/10) : cumulatif, 220 nouveaux et les changements de statut détectés", async () => {
    const { preview } = await runImport(db, "export_2026-10-12.csv");
    expect(preview.type).toBe("cumulatif");
    expect(preview.nouveaux).toBe(220);
    // 17 changements de statut, 1 de montant, les autres d'encaissement
    expect(preview.modifies).toBe(25);
    expect(preview.changementsStatut.reduce((s, c) => s + c.nombre, 0)).toBe(17);
    const [{ n }] = await db.execute<{ n: number }>("select count(*)::int as n from dossiers").then((r: any) => r.rows ?? r);
    expect(n).toBe(31695);
  });

  it("les instantanés recalculés retrouvent la recette 04_clients.json", async () => {
    const snaps = await db.select().from(clientSnapshots);
    for (const c of reference.clients) {
      const s = snaps.find((x) => x.clientId === c.id)!;
      expect(s.reference).toBe("2026-10-12");
      expect(Math.abs(s.sante - c.sante), c.id).toBeLessThanOrEqual(1);
      expect(s.risque, c.id).toBe(c.risque);
    }
  });

  it("réimporter le même fichier ne crée rien (pas de doublon)", async () => {
    const { preview } = await runImport(db, "export_2026-10-12.csv", false);
    expect(preview.nouveaux).toBe(0);
    expect(preview.modifies).toBe(0);
  });

  it("annuler le dernier import restaure l'état du 05/10", async () => {
    // abandonne le brouillon du test précédent
    await db.update(imports).set({ statut: "abandonne" }).where(eq(imports.statut, "brouillon"));
    const { diff } = await undoLastImport(db);
    expect(diff.reference).toBe("2026-10-05");
    const rows = await db.select().from(dossiers);
    expect(rows).toHaveLength(31475);
    const d = rows.find((r) => r.idResa === "342841")!;
    expect(d.statut).toBe("En Cours");
  });
});
