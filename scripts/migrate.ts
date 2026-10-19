/**
 * Applique les migrations SQL (dossier drizzle/) puis initialise le référentiel
 * (critères et clients) si la base est vide. Lancé automatiquement par `vercel-build`.
 */
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { getDb } from "../src/db";
import { seedReferentiel } from "../src/lib/seed";
import { importAuditsV1 } from "../src/lib/server/audits";

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
  console.log({ ...r, auditsImportes });
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
