import { Download } from "lucide-react";
import { getDb } from "@/db";
import { fileFiabilite, rapportFiabilite, SEUIL_PLATEFORME, MIN_SITES_PLATEFORME } from "@/lib/server/fiabilite";
import { BoutonAction } from "@/components/admin/FormAdmin";
import { BasculePlateforme } from "@/components/admin/BasculePlateforme";
import { fmtDateTime } from "@/lib/format";
import { lancerFiabiliteAction } from "../actions";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

/** Lot E : quels contrôles automatiques sont réellement vérifiables sur tout le portefeuille. */
export default async function FiabilitePage() {
  const db = await getDb();
  const [r, file] = await Promise.all([rapportFiabilite(db), fileFiabilite(db)]);
  const worker = process.env.SCAN_MODE === "worker";
  return (
    <div className="space-y-6">
      <section className="carte p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-3xl text-sm">
            <p>Un pré-audit (sans enregistrer d&apos;audit) est lancé sur le site principal de chaque client. Le tableau donne, pour chaque contrôle automatique, la répartition des résultats, la confiance moyenne et la cause principale des « non vérifiable ».</p>
            <p className="mt-1 text-gris-texte">
              {r.campagne ? `Dernière campagne : ${fmtDateTime(new Date(r.campagne.lanceeLe))}, ${r.campagne.sites} sites. ` : "Aucune campagne lancée. "}
              {r.sitesAnalyses} site(s) analysé(s){Object.keys(r.modes).length ? ` (${Object.entries(r.modes).map(([m, n]) => `${n} ${m === "navigateur" ? "avec navigateur" : "sans navigateur"}`).join(", ")})` : ""}{file ? `, ${file} en file` : ""}{r.erreurs ? `, ${r.erreurs} en erreur` : ""}.
            </p>
            {!worker && <p className="mt-1 font-semibold text-rouge-texte">Worker navigateur non déployé : la campagne tourne sans navigateur (lots chaque nuit) et une partie des contrôles sera « site sans navigateur ».</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <BoutonAction action={lancerFiabiliteAction} label="Lancer la campagne" className="btn-primaire" confirmation="Lancer un pré-audit sur le site de chaque client actif (sans créer d'audit) ?" />
            <a href="/api/admin/fiabilite" className="btn-secondaire"><Download size={14} aria-hidden /> CSV</a>
          </div>
        </div>
      </section>

      {r.chantiersProduit.length > 0 && (
        <section className="carte p-4" aria-labelledby="produit-titre">
          <h2 id="produit-titre" className="text-lg">Chantiers produit pour Speedmedia</h2>
          <p className="text-sm text-gris-texte">Critères « plateforme » (proposés ou retenus) dont le résultat dominant n&apos;est pas OUI : à corriger dans les gabarits SpeedResa, pas chez chaque client.</p>
          <ul className="mt-2 space-y-1 text-sm">{r.chantiersProduit.map((c) => <li key={c.critereId}><strong>{c.critereId}</strong> {c.critere} — {c.clients} client(s) concerné(s) sur {c.sur}</li>)}</ul>
        </section>
      )}

      <section className="carte overflow-x-auto" aria-labelledby="fia-titre">
        <h2 id="fia-titre" className="border-b border-gris-clair p-4 text-lg">Contrôles automatiques ({r.lignes.length})</h2>
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte">
            <tr>{["Critère", "OUI", "PARTIEL", "NON", "Non vérif.", "N.A.", "Vérifiable", "Confiance", "Cause principale du non vérifiable", "Plateforme"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {r.lignes.map((l) => (
              <tr key={l.critereId} className="border-t border-gris-clair align-top">
                <td className="px-3 py-2"><strong>{l.critereId}</strong> <span className="text-gris-texte">{l.critere.split(/[:(]/)[0].trim().slice(0, 60)}</span></td>
                <td className="px-3 py-2 tabular-nums">{l.oui}</td>
                <td className="px-3 py-2 tabular-nums">{l.partiel}</td>
                <td className="px-3 py-2 tabular-nums">{l.non}</td>
                <td className={`px-3 py-2 tabular-nums ${l.sites && l.nonVerifiable / l.sites > 0.5 ? "font-semibold text-rouge-texte" : ""}`}>{l.nonVerifiable}</td>
                <td className="px-3 py-2 tabular-nums">{l.na}</td>
                <td className="px-3 py-2 tabular-nums">{l.sites ? pct(l.verifiable) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{pct(l.confianceMoyenne)}</td>
                <td className="px-3 py-2 text-xs">{l.causePrincipale ? `${l.causePrincipale} (${l.causes[l.causePrincipale]})` : "—"}</td>
                <td className="px-3 py-2"><BasculePlateforme critereId={l.critereId} actif={l.plateforme} propose={l.plateformeProposee} dominant={l.dominant} part={l.partDominant} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="p-4 text-xs text-gris-texte">« Plateforme » est proposé quand au moins {Math.round(SEUIL_PLATEFORME * 100)} % des sites vérifiés (et au moins {MIN_SITES_PLATEFORME}) ont le même résultat : il est alors probablement produit par les gabarits SpeedResa. Un critère marqué « Plateforme » reste affiché mais ne compte plus dans le score des clients ni dans leur plan d&apos;action.</p>
      </section>
    </div>
  );
}
