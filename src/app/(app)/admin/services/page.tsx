import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scanRuns } from "@/db/schema";
import { lireParametre } from "@/lib/server/parametres";
import { SERVICES, type EtatService, type Service } from "@/lib/services/etat";
import { ga4Configure } from "@/lib/ga4/client";
import { etatGa4 } from "@/lib/server/ga4";
import { exportsDisponibles, sourceAbandon } from "@/lib/server/backoffice";
import { LIBELLES_TYPE, type TypeBackoffice } from "@/lib/import/backoffice";
import { CRITERES_PAR_EXPORT } from "@/lib/audit/backoffice";
import { FormAdmin } from "@/components/admin/FormAdmin";
import { fmtDateTime } from "@/lib/format";
import { sourceAbandonAction } from "../actions";

const configure: Record<Service, () => boolean> = {
  places: () => !!process.env.GOOGLE_PLACES_API_KEY,
  pagespeed: () => !!process.env.GOOGLE_PAGESPEED_API_KEY,
  anthropic: () => !!process.env.ANTHROPIC_API_KEY,
  resend: () => !!process.env.RESEND_API_KEY,
  ga4: () => ga4Configure(),
  worker: () => process.env.SCAN_MODE === "worker",
};

/** Clés d'API, worker de scan et exports back-office : configuré ou non, dernier appel réussi, critères dépendants. */
export default async function ServicesPage() {
  const db = await getDb();
  const [etat, ga4, dispo, src, [dernierNav]] = await Promise.all([
    lireParametre<Record<string, EtatService>>(db, "etat_services"),
    etatGa4(db), exportsDisponibles(db), sourceAbandon(db),
    db.select({ fin: scanRuns.fin }).from(scanRuns).where(eq(scanRuns.mode, "navigateur")).orderBy(desc(scanRuns.fin)).limit(1),
  ]);
  const e = etat ?? {};
  // GA4 : la dernière synchronisation fait foi ; worker : dernier scan avec navigateur
  if (ga4.derniereSync && (!e.ga4?.dernierSucces || e.ga4.dernierSucces < ga4.derniereSync)) e.ga4 = { ...e.ga4, dernierSucces: ga4.derniereSync };
  if (dernierNav?.fin && (!e.worker?.dernierSucces || e.worker.dernierSucces < dernierNav.fin.toISOString())) e.worker = { ...e.worker, dernierSucces: dernierNav.fin.toISOString() };
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-gris-texte">Les clés se renseignent dans les variables d&apos;environnement Vercel (Settings → Environment Variables), puis Redeploy. « Dernier succès » et « dernier échec » sont relevés à chaque appel réel (scan, email, synchronisation).</p>
      <section className="carte overflow-x-auto" aria-labelledby="svc-titre">
        <h2 id="svc-titre" className="border-b border-gris-clair p-4 text-lg">Services</h2>
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr>{["Service", "Variable", "État", "Dernier succès", "Dernier échec", "Critères qui en dépendent"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {SERVICES.map((s) => {
              const ok = configure[s.id](), x = e[s.id] ?? {};
              const echecRecent = x.dernierEchec && (!x.dernierSucces || x.dernierEchec > x.dernierSucces);
              return (
                <tr key={s.id} className="border-t border-gris-clair align-top">
                  <td className="px-3 py-2 font-semibold">{s.nom}{s.id === "ga4" && <Link href="/admin/google-analytics" className="ml-2 text-xs font-normal text-horizon hover:underline">configurer</Link>}</td>
                  <td className="px-3 py-2 font-mono text-xs">{s.variable}</td>
                  <td className="px-3 py-2">{ok ? (echecRecent ? <span className="font-semibold text-rouge-texte">Configuré, en erreur</span> : <span className="text-[#0b7a5e]">Configuré</span>) : <span className="font-semibold text-rouge-texte">Non configuré</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{x.dernierSucces ? fmtDateTime(new Date(x.dernierSucces)) : "—"}</td>
                  <td className="px-3 py-2">{x.dernierEchec ? <><span className="whitespace-nowrap">{fmtDateTime(new Date(x.dernierEchec))}</span><br /><span className="text-xs text-gris-texte">{x.message}</span></> : "—"}</td>
                  <td className="px-3 py-2 text-xs">{s.criteres}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="carte overflow-x-auto" aria-labelledby="exp-titre">
        <h2 id="exp-titre" className="border-b border-gris-clair p-4 text-lg">Exports back-office</h2>
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr>{["Export", "Dernier import", "Critères automatiques"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {(["catalogue", "configuration", "connexions", "paybox"] as TypeBackoffice[]).map((t) => (
              <tr key={t} className="border-t border-gris-clair">
                <td className="px-3 py-2 font-semibold">{LIBELLES_TYPE[t]}</td>
                <td className="px-3 py-2">{dispo.get(t) ? fmtDateTime(dispo.get(t)!) : <span className="text-gris-texte">Jamais importé : critères manuels « en attente de l&apos;export »</span>}</td>
                <td className="px-3 py-2 text-xs">{t === "connexions" ? "SOC-08 et alerte « aucune connexion depuis 30 jours »" : (CRITERES_PAR_EXPORT as Record<string, string[]>)[t].join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="p-4 text-xs text-gris-texte">Déposez ces fichiers avec l&apos;extract du lundi (« Mettre à jour les chiffres ») : leur type est reconnu à leurs colonnes.</p>
      </section>

      <section className="carte p-4" aria-labelledby="perf07-titre">
        <h2 id="perf07-titre" className="text-lg">Abandon panier (PERF-07) : source</h2>
        <FormAdmin action={sourceAbandonAction}>
          <fieldset className="mt-2 space-y-2 text-sm">
            <legend className="sr-only">Source de l&apos;abandon panier</legend>
            <label className="flex items-start gap-2"><input type="radio" name="source" value="ga4" defaultChecked={src === "ga4"} className="mt-1" /> <span><strong>Google Analytics 4</strong> : 1 − achats ÷ débuts de réservation (événements begin_checkout / purchase), déjà relevés chaque mois.</span></label>
            <label className="flex items-start gap-2"><input type="radio" name="source" value="dossiers" defaultChecked={src === "dossiers"} className="mt-1" /> <span><strong>Export dossiers enrichi</strong> : part des paniers avec email renseigné qui n&apos;aboutissent pas (colonne « Email renseigné »).</span></label>
          </fieldset>
          <p className="mt-2 text-xs text-gris-texte">Choix à confirmer avec Martin (08_DEMANDES_EQUIPES_EXPORTS, question 1).</p>
        </FormAdmin>
      </section>
    </div>
  );
}
