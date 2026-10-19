/** Pré-audit en ligne de commande, sans base : npm run scan -- https://www.exemple.fr [--json] */
import { executerDetecteurs } from "../src/scan/runner";

async function main() {
  const urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const json = process.argv.includes("--json");
  const tout: Record<string, unknown> = {};
  for (const url of urls) {
    const debut = Date.now();
    const s = await executerDetecteurs(url, {
      onProgress: (p) => { if (!json && p.resultat) console.log(`  ${p.critereId.padEnd(8)} ${(p.resultat.statut ?? "N/V").padEnd(14)} ${p.resultat.confiance.padEnd(8)} ${p.resultat.texte}`); },
    });
    const duree = Math.round((Date.now() - debut) / 1000);
    if (!json) console.log(`\n${url} — ${s.statut}, mode ${s.mode}, ${duree} s${s.message ? ` — ${s.message}` : ""}\n`);
    tout[url] = { duree, mode: s.mode, statut: s.statut, resultats: Object.fromEntries([...s.resultats].map(([k, r]) => [k, { statut: r.statut, confiance: r.confiance, texte: r.texte, preuve: r.preuve.texte }])) };
  }
  if (json) console.log(JSON.stringify(tout, null, 1));
  process.exit(0);
}
main();
