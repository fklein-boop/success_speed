/**
 * Applique les migrations SQL (dossier drizzle/) puis initialise le référentiel
 * (critères et clients) si la base est vide. Lancé automatiquement par `vercel-build`.
 */
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { getDb } from "../src/db";
import { seedReferentiel } from "../src/lib/seed";
import { importAuditsV1 } from "../src/lib/server/audits";
import { nettoyageLotD } from "../src/lib/server/referentiel";
import { recomputeAll } from "../src/lib/server/recompute";
import { ajoutsTableProduction } from "../src/lib/server/facturation";

async function main() {
  const db = await getDb();
  if (process.env.DATABASE_URL) {
    await migrateNeon(db, { migrationsFolder: "drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "drizzle" });
  }
  console.log("Migrations appliquées.");
  const r = await seedReferentiel(db);
  const auditsImportes = await importAuditsV1(db);
  // Lot D : une seule fois (paramètre « migration_lot_d »)
  const lotD = await nettoyageLotD(db);
  if (lotD) { await recomputeAll(db); console.log("Lot D appliqué :", lotD); }
  const prod = await ajoutsTableProduction(db);
  if (prod.length) console.log("Table de production complétée :", prod);
  console.log({ ...r, auditsImportes });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
