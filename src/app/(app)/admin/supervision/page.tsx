import Link from "next/link";
import { Download } from "lucide-react";
import { getDb } from "@/db";
import { durees, etatMonitoring } from "@/lib/server/pilotage";
import { etatCampagnes } from "@/lib/server/scans";
import { BoutonAction } from "@/components/admin/FormAdmin";
import { fmtDate } from "@/lib/format";
import { lancerRescanAction } from "../actions";

const duree = (s: number | null) => (s === null ? "—" : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);
const pct = (x: number | null, d = 0) => (x === null ? "—" : `${(x * 100).toFixed(d).replace(".", ",")} %`);
const STATUTS: Record<string, string> = { en_attente: "en file", en_cours: "en cours", termine: "terminés", erreur: "en erreur", auth: "derrière authentification" };

/** Durées (objectifs de la spec), monitoring de disponibilité, scans planifiés, export du portefeuille. */
export default async function SupervisionPage() {
  const db = await getDb();
  const [d, mon, camp] = await Promise.all([durees(db), etatMonitoring(db), etatCampagnes(db)]);
  const pannes = mon.filter((m) => m.panne);
  const worker = process.env.SCAN_MODE === "worker";
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2" aria-label="Durées">
        <div className="carte p-4">
          <p className="libelle">Pré-audit automatique (objectif : moins de 3 min)</p>
          <p className="font-titres text-3xl font-bold tabular-nums">{duree(d.preAudit.mediane)}</p>
          <p className="text-sm text-gris-texte">Médiane sur {d.preAudit.n} scan(s) complets (90 j) · {pct(d.preAudit.sousObjectif)} sous l&apos;objectif</p>
        </div>
        <div className="carte p-4">
          <p className="libelle">Complétion d&apos;un audit (objectif : moins de 10 min)</p>
          <p className="font-titres text-3xl font-bold tabular-nums">{duree(d.completion.mediane)}</p>
          <p className="text-sm text-gris-texte">Médiane sur {d.completion.n} audit(s) finalisé(s) (90 j) · {pct(d.completion.sousObjectif)} sous l&apos;objectif. Temps actif : intervalles entre deux réponses du CSM, plafonnés à 5 min.</p>
        </div>
      </section>

      <section className="carte p-4" aria-labelledby="rescan-titre">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="rescan-titre" className="text-lg">Rescan mensuel</h2>
            <p className="text-sm text-gris-texte">Le 1er de chaque mois : contrôle léger de tous les sites (cookies, mentions légales, module SpeedResa, certificat, PageSpeed) pour alimenter les alertes. {worker ? "Exécuté par le worker." : "Sans worker, la file est traitée chaque nuit par petits lots (environ 5 minutes par nuit)."}</p>
          </div>
          <BoutonAction action={lancerRescanAction} label="Lancer maintenant" confirmation="Mettre en file un rescan léger de tous les sites clients ?" />
        </div>
        <p className="mt-2 text-sm">{camp.length ? `40 derniers jours : ${camp.map((c) => `${c.n} ${STATUTS[c.statut] ?? c.statut}`).join(", ")} (dernier lancement le ${fmtDate(camp.map((c) => c.dernier).sort().at(-1)!)}).` : "Aucun rescan sur les 40 derniers jours."}</p>
      </section>

      <section className="carte overflow-x-auto p-4" aria-labelledby="monitoring-titre">
        <h2 id="monitoring-titre" className="text-lg">Disponibilité des sites (30 jours)</h2>
        <p className="text-sm text-gris-texte">Mesure toutes les 15 minutes par le worker (ou par la route <code>/api/cron/disponibilite</code>). Une alerte « site inaccessible » s&apos;ouvre après 4 échecs consécutifs (1 h).{pannes.length ? ` ${pannes.length} site(s) inaccessible(s) en ce moment.` : ""}</p>
        {mon.length ? (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-xs text-gris-texte"><tr>{["Client", "Disponibilité", "Mesures", "Temps de réponse moyen", "Dernière mesure", "État"].map((h) => <th key={h} className="py-1 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{mon.map((m) => (
              <tr key={m.clientId} className="border-t border-gris-clair">
                <td className="py-1.5 pr-3"><Link href={`/clients/${m.clientId}`} className="text-horizon hover:underline">{m.nom}</Link></td>
                <td className={`py-1.5 pr-3 tabular-nums ${m.taux !== null && m.taux < 0.995 ? "font-semibold text-rouge-texte" : ""}`}>{pct(m.taux, 2)}</td>
                <td className="py-1.5 pr-3 tabular-nums">{m.mesures}</td>
                <td className="py-1.5 pr-3 tabular-nums">{m.tempsMoyen ? `${(m.tempsMoyen / 1000).toFixed(1).replace(".", ",")} s` : "—"}</td>
                <td className="py-1.5 pr-3">{fmtDate(m.derniere)}</td>
                <td className="py-1.5">{m.panne ? <span className="font-semibold text-rouge-texte">Inaccessible depuis le {fmtDate(m.panne.depuis)}</span> : "En ligne"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="mt-3 text-sm text-gris-texte">Aucune mesure : le monitoring démarre avec le worker (ou la tâche planifiée toutes les 15 minutes).</p>}
      </section>

      <section className="carte flex flex-wrap items-center justify-between gap-3 p-4" aria-labelledby="export-titre">
        <div>
          <h2 id="export-titre" className="text-lg">Export du portefeuille</h2>
          <p className="text-sm text-gris-texte">Tous les clients avec leurs scores, alertes et opportunités (CSV pour Excel). Contient des données internes : à ne pas transmettre aux clients.</p>
        </div>
        <a href="/api/portefeuille/export" className="btn-secondaire"><Download size={15} aria-hidden /> Télécharger le CSV</a>
      </section>
    </div>
  );
}
