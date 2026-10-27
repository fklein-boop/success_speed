import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "./schema";

export type DB = ReturnType<typeof drizzleNeon<typeof schema>>;

const g = globalThis as unknown as { __db?: Promise<DB> };

/**
 * Production (Vercel) : Neon PostgreSQL via DATABASE_URL.
 * Développement sans DATABASE_URL : PostgreSQL embarqué (PGlite) dans .data/pglite.
 */
async function create(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzleNeon({ client: new Pool({ connectionString: url }), schema });
  }
  if (process.env.VERCEL) throw new Error("DATABASE_URL manquante");
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  if (dir !== "memory") (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = dir === "memory" ? new PGlite() : new PGlite(dir);
  // Base locale sur disque : fermeture propre à l'arrêt du serveur (un arrêt brutal pendant une écriture l'endommage)
  if (dir !== "memory") {
    const fermer = () => { void client.close().catch(() => null).finally(() => process.exit(0)); };
    process.once("SIGTERM", fermer);
    process.once("SIGINT", fermer);
  }
  return drizzle({ client, schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  return (g.__db ??= create());
}

export { schema };
