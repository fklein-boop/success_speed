import { getDb } from "@/db";
import { connexionGa4, etatGa4, MOIS_GA4 } from "@/lib/server/ga4";
import { BoutonAction, FormAdmin } from "@/components/admin/FormAdmin";
import { SynchroGa4 } from "@/components/admin/SynchroGa4";
import { fmtDate } from "@/lib/format";
import { configGa4Action, effacerGa4Action } from "../actions";

const fr = (k: string) => `${k.slice(5, 7)}/${k.slice(0, 4)}`;

/** Connexion à la propriété Google Analytics 4 consolidée (tous les sites clients, paramètre « Nom du client »). */
export default async function GoogleAnalyticsPage() {
  const db = await getDb();
  const [cx, etat] = await Promise.all([connexionGa4(db), etatGa4(db)]);
  const c = cx.config;
  const pret = cx.configure && !cx.erreur && !!c.propertyId && !!c.dimension;
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-gris-texte">
        Une seule propriété Google Analytics 4 réunit les sites de tous les clients ; chaque événement porte le paramètre « Nom du client ».
        L&apos;outil relève chaque mois, par client, les sessions, les débuts de réservation, les achats et le CA web des {MOIS_GA4} derniers mois complets.
        Ces mesures remplacent le fichier « 4. Métriques GTM » pour les mois concernés et donnent la conversion web et l&apos;abandon panier. Accès en lecture seule.
      </p>

      <section className="carte p-4" aria-labelledby="ga4-cx">
        <h2 id="ga4-cx" className="text-lg">1. Connexion</h2>
        {!cx.configure ? (
          <p className="mt-2 text-sm">Clé du compte de service absente. Ajoutez la variable <code>GA4_CREDENTIALS</code> (contenu du fichier JSON) dans Vercel, ou <code>GA4_CREDENTIALS_FILE</code> (chemin du fichier) dans <code>.env.local</code>, puis redémarrez. Voir DEPLOIEMENT.md.</p>
        ) : (
          <p className="mt-2 text-sm">Compte de service : <code>{cx.compte}</code>. {cx.erreur ? <span role="alert" className="font-semibold text-rouge-texte">{cx.erreur}</span> : <span className="text-[#0b7a5e]">Connexion à Google réussie, {cx.proprietes.length} propriété(s) accessible(s).</span>}</p>
        )}
        {cx.configure && !cx.erreur && !cx.proprietes.length && <p className="mt-1 text-sm text-rouge-texte">Aucune propriété accessible : dans Google Analytics, Administration → Gestion des accès à la propriété → ajoutez <code>{cx.compte}</code> avec le rôle « Lecteur ».</p>}
      </section>

      <section className="carte p-4" aria-labelledby="ga4-conf">
        <h2 id="ga4-conf" className="text-lg">2. Propriété et dimension « Nom du client »</h2>
        <FormAdmin action={configGa4Action} bouton="Enregistrer">
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="text-sm">Propriété
              {cx.proprietes.length ? (
                <select name="propertyId" defaultValue={c.propertyId ?? ""} className="champ mt-1">
                  <option value="">— Choisir —</option>
                  {cx.proprietes.map((p) => <option key={p.id} value={p.id}>{p.nom} · {p.compte} ({p.id})</option>)}
                </select>
              ) : <input name="propertyId" defaultValue={c.propertyId ?? ""} inputMode="numeric" placeholder="ex. 312345678" className="champ mt-1" />}
            </label>
            <label className="text-sm">Dimension qui identifie le client
              {cx.dimensionsPerso.length ? (
                <select name="dimension" defaultValue={c.dimension ?? ""} className="champ mt-1">
                  <option value="">— Choisir —</option>
                  {cx.dimensionsPerso.map((d) => <option key={d.apiName} value={d.apiName}>{d.nom} ({d.apiName})</option>)}
                </select>
              ) : <input name="dimension" defaultValue={c.dimension ?? ""} placeholder="customEvent:nom_du_client" className="champ mt-1 font-mono text-xs" />}
              {cx.dimensionsPerso.map((d) => <input key={d.apiName} type="hidden" name={`nom.${d.apiName}`} value={d.nom} />)}
            </label>
            <label className="text-sm">Événement « début de réservation »<input name="evenementDebut" defaultValue={c.evenementDebut} className="champ mt-1 font-mono text-xs" /></label>
            <label className="text-sm">Événement « réservation finalisée »<input name="evenementAchat" defaultValue={c.evenementAchat} className="champ mt-1 font-mono text-xs" /></label>
          </div>
          {cx.configure && !cx.erreur && c.propertyId && !cx.dimensionsPerso.length && (
            <p className="mt-2 text-sm text-rouge-texte">Aucune dimension personnalisée sur cette propriété : dans GA4, Administration → Définitions personnalisées → Créer une dimension personnalisée, portée « Événement », paramètre d&apos;événement « Nom du client » (tel qu&apos;envoyé par GTM). Les données ne sont disponibles qu&apos;à partir de sa création.</p>
          )}
          {c.dimensionNom && <p className="mt-2 text-sm text-gris-texte">Dimension retenue : « {c.dimensionNom} ».</p>}
        </FormAdmin>
      </section>

      <section className="carte p-4" aria-labelledby="ga4-sync">
        <h2 id="ga4-sync" className="text-lg">3. Synchronisation</h2>
        <p className="mt-1 text-sm">
          {etat.derniereSync ? `Dernière synchronisation le ${fmtDate(etat.derniereSync)} : ${etat.clients} client(s)${etat.mois.length ? `, ${fr(etat.mois[0])} à ${fr(etat.mois.at(-1)!)}` : ""}.` : "Jamais synchronisé."}
          {" "}Relevé automatique le 2 de chaque mois.
        </p>
        {etat.erreur && <p role="alert" className="mt-1 text-sm text-rouge-texte">Dernière tentative en échec : {etat.erreur}</p>}
        {etat.enAttente.length > 0 && <p className="mt-1 text-sm font-semibold">{etat.enAttente.length} valeur(s) à rattacher : {etat.enAttente.slice(0, 8).map((e) => `« ${e.valeur} »`).join(", ")}{etat.enAttente.length > 8 ? "…" : ""}. Cliquez sur « Vérifier les rattachements ».</p>}
        <div className="mt-3"><SynchroGa4 pret={pret} /></div>
        {etat.derniereSync && (
          <div className="mt-4 border-t border-gris-clair pt-3">
            <BoutonAction action={effacerGa4Action} label="Supprimer les mesures Google Analytics" className="btn-discret" confirmation="Supprimer toutes les mesures Google Analytics ? La conversion reviendra au fichier GTM (à réimporter)." />
          </div>
        )}
      </section>
    </div>
  );
}
