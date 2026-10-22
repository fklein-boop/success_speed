/**
 * Worker de pré-audit : exécute les scans en file d'attente avec un vrai navigateur (Playwright).
 * À déployer hors Vercel (voir Dockerfile.worker et le README), avec SCAN_MODE=worker côté Vercel.
 * Plusieurs workers peuvent tourner en parallèle (réservation atomique « skip locked »).
 */
import { getDb } from "../src/db";
import { executerScan, reserverProchainScan } from "../src/lib/server/scans";
import { mesurerDisponibilite } from "../src/lib/server/disponibilite";
import { recomputeAll } from "../src/lib/server/recompute";
import { navigateurDisponible } from "../src/scan/browser";
import { noterService } from "../src/lib/services/etat";

const PAUSE_MS = 3000;
/** Monitoring de disponibilité (TECH-04) : toutes les 15 minutes (SCAN_MONITORING=non pour le couper) */
const MONITORING_MS = 15 * 60_000;
let arret = false;
process.on("SIGTERM", () => { arret = true; });
process.on("SIGINT", () => { arret = true; });

async function main() {
  const db = await getDb();
  const nav = await navigateurDisponible();
  console.log(`Worker de scan démarré — navigateur : ${nav ? "oui" : "non (mode dégradé)"}`);
  // Signe de vie pour l'écran « État des services » (écrit au plus toutes les 5 minutes)
  const vivant = () => void noterService("worker", nav, nav ? undefined : "Navigateur indisponible : scans en mode dégradé");
  vivant();
  if (process.env.SCAN_MONITORING !== "non") {
    const tour = () => mesurerDisponibilite(db)
      .then((r) => console.log(`Disponibilité : ${r.mesures} site(s) testé(s), ${r.enPanne} en erreur`))
      .catch((e) => console.error("Disponibilité :", e));
    void tour();
    setInterval(() => void tour(), MONITORING_MS).unref();
  }
  let legersSansRecalcul = 0;
  while (!arret) {
    const id = await reserverProchainScan(db).catch((e) => { console.error(e); return null; });
    vivant();
    if (id === null) {
      // Fin d'une campagne de rescan mensuel : un seul recalcul des alertes
      if (legersSansRecalcul) { await recomputeAll(db).catch((e) => console.error(e)); legersSansRecalcul = 0; }
      await new Promise((r) => setTimeout(r, PAUSE_MS));
      continue;
    }
    legersSansRecalcul++;
    const debut = Date.now();
    console.log(`Scan ${id} : début`);
    await executerScan(db, id, { dejaReserve: true }).catch((e) => console.error(`Scan ${id} :`, e));
    console.log(`Scan ${id} : terminé en ${Math.round((Date.now() - debut) / 1000)} s`);
  }
  process.exit(0);
}

main();
