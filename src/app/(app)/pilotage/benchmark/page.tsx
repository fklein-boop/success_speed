import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { loadPortfolio } from "@/lib/server/portfolio";
import { fmtEurCompact } from "@/lib/format";
import { getDb } from "@/db";
import { benchmark, EFFECTIF_FIABLE } from "@/lib/server/pilotage";
import { NuageMaturite } from "@/components/pilotage/NuageMaturite";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);
const evol = (x: number | null) => (x === null ? "—" : `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`);

/** Benchmark (§ 7) : ce qui distingue les Champions, et évolution des clients OUI vs NON par critère. */
export default async function BenchmarkPage() {
  const db = await getDb();
  const b = await benchmark(db);
  const { rows } = await loadPortfolio(db);
  const avecTrafic = rows.some((r) => r.m?.mois_trafic);
  const manques = rows.filter((r) => r.m?.manque_a_gagner_mensuel && r.m.manque_a_gagner_mensuel > 0).map((r) => ({
    id: r.id, nom: r.nom, manque: r.m!.manque_a_gagner_mensuel!, visites: r.m!.visites_mensuelles ?? 0, conversion: r.m!.conversion ?? 0, reference: r.m!.conversion_reference ?? 0, source: r.m!.conversion_reference_source === "Champions" ? "Champions" : "portefeuille",
  })).sort((a, z) => z.manque - a.manque);
  const fiables = b.parCritere.filter((c) => c.evolOui.n + c.evolNon.n > 0).sort((a, z) => ((z.evolOui.moyenne ?? 0) - (z.evolNon.moyenne ?? 0)) - ((a.evolOui.moyenne ?? 0) - (a.evolNon.moyenne ?? 0)));
  return (
    <div className="space-y-6">
      <p className="text-sm text-gris-texte">Basé sur le dernier audit finalisé de chaque client ({b.nbAudits} client{b.nbAudits > 1 ? "s" : ""} audité{b.nbAudits > 1 ? "s" : ""}) et sur les données SpeedResa du dernier import.</p>
      {b.nbAudits < EFFECTIF_FIABLE && (
        <p className="flex items-start gap-2 rounded-lg bg-ambre/15 p-3 text-sm"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> Petits effectifs : avec {b.nbAudits} audit(s), ces comparaisons sont des pistes, pas des conclusions (corrélation, pas causalité). Elles deviendront parlantes à partir d&apos;une dizaine d&apos;audits par groupe.</p>
      )}

      <section className="carte p-4" aria-labelledby="ecarts-titre">
        <h2 id="ecarts-titre" className="text-lg">Ce qui distingue les Champions</h2>
        <p className="text-xs text-gris-texte">Taux de OUI au dernier audit chez les Champions et chez les autres segments : les 5 écarts les plus marqués.</p>
        {b.ecarts.length ? (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-gris-texte"><tr><th className="py-1 font-semibold">Critère</th><th className="py-1 font-semibold">Champions</th><th className="py-1 font-semibold">Autres</th><th className="py-1 font-semibold">Écart</th></tr></thead>
            <tbody>{b.ecarts.map((c) => (
              <tr key={c.id} className="border-t border-gris-clair">
                <td className="py-1.5 pr-3"><span className="text-xs text-gris-texte">{c.id}</span> {c.critere}</td>
                <td className="py-1.5 tabular-nums">{pct(c.champions.taux)} <span className="text-xs text-gris-texte">(n={c.champions.n})</span></td>
                <td className="py-1.5 tabular-nums">{pct(c.autres.taux)} <span className="text-xs text-gris-texte">(n={c.autres.n})</span></td>
                <td className="py-1.5 font-semibold tabular-nums">{c.ecart! > 0 ? "+" : ""}{Math.round(c.ecart! * 100)} pts</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="mt-3 text-sm text-gris-texte">Il faut au moins un Champion et un client d&apos;un autre segment audités.</p>}
      </section>

      <section className="carte p-4" aria-labelledby="nuage-titre">
        <h2 id="nuage-titre" className="text-lg">Maturité × évolution du volume (90 j vs N-1)</h2>
        {b.nuage.length ? <NuageMaturite points={b.nuage} /> : <p className="mt-3 text-sm text-gris-texte">Aucun client audité avec des données de volume.</p>}
      </section>

      <section className="carte overflow-x-auto p-4" aria-labelledby="ouinon-titre">
        <h2 id="ouinon-titre" className="text-lg">Évolution moyenne des clients OUI vs NON, par critère</h2>
        <p className="text-xs text-gris-texte">Évolution du volume 90 j (vs N-1) des clients ayant OUI ou NON au dernier audit. ⚠ = moins de {EFFECTIF_FIABLE} clients dans un groupe : corrélation, pas causalité.</p>
        {fiables.length ? (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-gris-texte"><tr><th className="py-1 font-semibold">Critère</th><th className="py-1 font-semibold">Clients OUI</th><th className="py-1 font-semibold">Clients NON</th><th className="py-1 font-semibold">Différence</th></tr></thead>
            <tbody>{fiables.map((c) => {
              const petit = c.evolOui.n < EFFECTIF_FIABLE || c.evolNon.n < EFFECTIF_FIABLE;
              const diff = c.evolOui.moyenne !== null && c.evolNon.moyenne !== null ? c.evolOui.moyenne - c.evolNon.moyenne : null;
              return (
                <tr key={c.id} className="border-t border-gris-clair">
                  <td className="py-1.5 pr-3"><span className="text-xs text-gris-texte">{c.id}</span> {c.critere.split(/[:(]/)[0]}</td>
                  <td className="py-1.5 tabular-nums">{evol(c.evolOui.moyenne)} <span className="text-xs text-gris-texte">(n={c.evolOui.n})</span></td>
                  <td className="py-1.5 tabular-nums">{evol(c.evolNon.moyenne)} <span className="text-xs text-gris-texte">(n={c.evolNon.n})</span></td>
                  <td className="py-1.5 tabular-nums">{diff === null ? "—" : `${diff > 0 ? "+" : ""}${Math.round(diff * 100)} pts`} {petit && <span title="Effectif inférieur à 10 : corrélation, pas causalité" aria-label="Petit effectif">⚠</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        ) : <p className="mt-3 text-sm text-gris-texte">Pas encore assez d&apos;audits finalisés.</p>}
      </section>

      <section className="carte p-4" aria-labelledby="manque-titre">
        <h2 id="manque-titre" className="text-lg">Manque à gagner estimé (conversion du trafic)</h2>
        <p className="text-xs text-gris-texte">(Conversion de référence − conversion du client) × visites mensuelles × panier moyen confirmé. Estimation : les dossiers saisis en agence sont comptés avec ceux du site.</p>
        {manques.length ? (
          <>
            <p className="mt-2 text-sm">Total : <strong>{fmtEurCompact(manques.reduce((s, x) => s + x.manque, 0))} par mois</strong> sur {manques.length} client(s) sous la référence.</p>
            <table className="mt-2 w-full text-sm">
              <thead className="text-left text-xs text-gris-texte"><tr><th className="py-1 font-semibold">Client</th><th className="py-1 font-semibold">Visites / mois</th><th className="py-1 font-semibold">Conversion</th><th className="py-1 font-semibold">Référence</th><th className="py-1 font-semibold">Manque / mois</th></tr></thead>
              <tbody>{manques.slice(0, 10).map((x) => (
                <tr key={x.id} className="border-t border-gris-clair">
                  <td className="py-1.5"><Link href={`/clients/${x.id}`} className="text-horizon hover:underline">{x.nom}</Link></td>
                  <td className="py-1.5 tabular-nums">{x.visites.toLocaleString("fr-FR")}</td>
                  <td className="py-1.5 tabular-nums">{(x.conversion * 100).toFixed(2).replace(".", ",")} %</td>
                  <td className="py-1.5 tabular-nums">{(x.reference * 100).toFixed(2).replace(".", ",")} % <span className="text-xs text-gris-texte">({x.source})</span></td>
                  <td className="py-1.5 font-semibold tabular-nums">{fmtEurCompact(x.manque)}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        ) : <p className="mt-2 text-sm text-gris-texte">{avecTrafic ? "Pas encore assez de clients avec du trafic pour une référence (3 Champions, ou 5 clients)." : <>Trafic non importé : <Link href="/imports" className="text-horizon hover:underline">importer l&apos;onglet « 4. Métriques GTM »</Link>.</>}</p>}
      </section>
    </div>
  );
}
