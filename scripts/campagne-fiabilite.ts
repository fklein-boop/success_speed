/**
 * Campagne de fiabilité (lot E) en ligne de commande : met en file un pré-audit « fiabilité » par site client,
 * les exécute un par un (navigateur si disponible), puis écrit le rapport CSV. Utile tant que le worker n'est pas déployé.
 * Usage : npx tsx scripts/campagne-fiabilite.ts <fichier.csv> [export_dossiers.csv]
 */
import { readFile, writeFile } from "node:fs/promises";
import { getDb } from "../src/db";
import { readTabularFile } from "../src/lib/import/read-file";
import { detectColumns, rowsToDossiers } from "../src/lib/import/dossiers";
import { createImport, addRows, applyImport, } from "../src/lib/server/imports";
import { executerScan, reserverProchainScan } from "../src/lib/server/scans";
import { csvFiabilite, lancerCampagneFiabilite, rapportFiabilite } from "../src/lib/server/fiabilite";
import { navigateurDisponible } from "../src/scan/browser";

async function main() {
  const [sortie, exportDossiers] = process.argv.slice(2);
  const db = await getDb();
  if (exportDossiers) {
    const b = await readFile(exportDossiers);
    const sheet = await readTabularFile(exportDossiers, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    const r = rowsToDossiers(sheet.rows, detectColumns(sheet.headers).mapping);
    const imp = await createImport(db, null, { fichier: "export", periode: r.periode, anomalies: r.anomalies, lignesLues: r.dossiers.length });
    await addRows(db, imp.id, r.dossiers);
    await applyImport(db, imp.id, null, { creer: [] });
  }
  console.log(`Navigateur : ${(await navigateurDisponible()) ? "oui" : "non"}`);
  const c = await lancerCampagneFiabilite(db, null);
  console.log(`${c.crees} pré-audits en file sur ${c.sites} sites, ${c.refus.length} refusés`, c.refus);
  let n = 0;
  for (;;) {
    const id = await reserverProchainScan(db);
    if (id === null) break;
    const t = Date.now();
    await executerScan(db, id, { dejaReserve: true }).catch((e) => console.error(`Scan ${id} :`, e));
    console.log(`${++n}/${c.crees} — scan ${id} en ${Math.round((Date.now() - t) / 1000)} s`);
  }
  await writeFile(sortie, await csvFiabilite(db));
  const r = await rapportFiabilite(db);
  console.log(JSON.stringify({ sites: r.sitesAnalyses, modes: r.modes, erreurs: r.erreurs, plateformeProposee: r.lignes.filter((l) => l.plateformeProposee).map((l) => `${l.critereId} ${l.dominant} ${Math.round(l.partDominant * 100)}%`), chantiersProduit: r.chantiersProduit }, null, 1));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
