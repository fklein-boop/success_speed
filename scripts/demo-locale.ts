/**
 * Recrée des données de démonstration locales (développement uniquement) : export dossiers réel s'il est fourni,
 * exports back-office d'exemple, compte de test super admin, audits S30 et P17.
 * Usage : npx tsx scripts/demo-locale.ts [export_dossiers.csv]   (après `npm run db:migrate` sur une base vide)
 */
import { readFile } from "node:fs/promises";
import { getDb } from "../src/db";
import { users } from "../src/db/schema";
import { readTabularFile } from "../src/lib/import/read-file";
import { detectColumns, rowsToDossiers } from "../src/lib/import/dossiers";
import { colonnesBackoffice, lireLignesBackoffice, typeDeFichier, type TypeBackoffice } from "../src/lib/import/backoffice";
import { createImport, addRows, applyImport } from "../src/lib/server/imports";
import { appliquerExport } from "../src/lib/server/backoffice";
import { createAudit } from "../src/lib/server/audits";

const lire = async (c: string) => { const b = await readFile(c); return readTabularFile(c, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
async function main() {
  if (process.env.DATABASE_URL) throw new Error("Script réservé à la base locale.");
  const db = await getDb();
  const [u] = await db.insert(users).values({ email: process.env.TEST_LOGIN_EMAIL ?? "test@speedmedia.test", nom: "Compte de test", role: "superadmin", peutImporter: true }).onConflictDoNothing().returning();
  const exportDossiers = process.argv[2] ?? "tests/fixtures/export_2026-10-12.csv";
  const sheet = await lire(exportDossiers);
  const r = rowsToDossiers(sheet.rows, detectColumns(sheet.headers).mapping);
  const imp = await createImport(db, u?.id ?? null, { fichier: exportDossiers, periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
  await addRows(db, imp.id, r.dossiers);
  await applyImport(db, imp.id, u?.id ?? null, { creer: [] });
  for (const nom of ["export_catalogue_2026-10-26.csv", "export_configuration_2026-10-26.csv", "export_connexions_2026-10-26.csv", "export_paybox_2026-09.csv"]) {
    const s = await lire(`tests/fixtures/backoffice/${nom}`);
    const type = typeDeFichier(s.headers) as TypeBackoffice;
    await appliquerExport(db, u?.id ?? null, type, nom, lireLignesBackoffice(type, s.rows, colonnesBackoffice(type, s.headers).mapping).lignes);
  }
  if (u) for (const id of ["S30", "P17"]) await createAudit(db, id, u.id);
  console.log(`Démo locale prête : ${r.dossiers.length} dossiers, exports d'exemple, audits S30 et P17.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
