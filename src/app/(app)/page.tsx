import Link from "next/link";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { canEdit, requireUser } from "@/lib/server/auth";
import { loadPortfolio } from "@/lib/server/portfolio";
import { fmtDate, fmtEurCompact, fmtPct, joursDepuis } from "@/lib/format";
import { Kpi } from "@/components/Kpi";
import { BoutonImport } from "@/components/import/ImportProvider";
import { PortfolioView } from "@/components/portefeuille/PortfolioView";
import { AFaire } from "@/components/pilotage/AFaire";
import { aFaire } from "@/lib/server/pilotage";
import { RechercheClient } from "@/components/portefeuille/RechercheClient";

export default async function PortefeuillePage() {
  const user = await requireUser();
  const db = await getDb();
  const [{ rows, reference, kpis, lastImport }, csms] = await Promise.all([
    loadPortfolio(db),
    db.select({ id: users.id, nom: users.nom, email: users.email, role: users.role }).from(users),
  ]);
  const age = joursDepuis(reference);
  // Super admin : tout le portefeuille ; CSM : ses clients (à défaut de clients attribués, tout le portefeuille)
  const mesClients = rows.some((r) => r.csmId === user.id);
  const fileAFaire = user.role === "lecture" ? null : await aFaire(db, user.role === "superadmin" || !mesClients ? null : user.id);

  if (!reference) {
    return (
      <div className="carte mx-auto mt-10 max-w-xl p-10 text-center">
        <h1 className="text-2xl">Bienvenue sur la plateforme d&apos;audit CSM</h1>
        <p className="mt-3 text-gris-texte">Aucune donnée SpeedResa n&apos;a encore été importée. Déposez l&apos;export dossiers (extract du lundi, ou le fichier Excel d&apos;origine) n&apos;importe où sur cette page.</p>
        <div className="mt-6 flex justify-center"><BoutonImport /></div>
      </div>
    );
  }

  const ytdTxt = kpis.evolYtd === null ? "—" : fmtPct(kpis.evolYtd, true);
  const phrase = `${kpis.nbClients} clients, ${fmtEurCompact(kpis.volume12)} de volume d'affaires sur 12 mois (${ytdTxt} depuis janvier vs N-1). ${kpis.critiques} client${kpis.critiques > 1 ? "s" : ""} critique${kpis.critiques > 1 ? "s" : ""} et ${kpis.surveiller} à surveiller.`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <RechercheClient clients={rows.map((r) => ({ id: r.id, nom: r.nom, groupe: r.groupe }))} />
        <a href="#mes-clients" className="btn-discret text-sm">Mes clients ↓</a>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">Portefeuille</h1>
          <p className="mt-1 max-w-3xl text-gris-texte">{phrase}</p>
        </div>
        <div className="text-right text-sm">
          <p>Données au <strong>{fmtDate(reference)}</strong></p>
          {age !== null && age > 8 && <p className="font-semibold text-rouge-texte">⚠ Chiffres datant de {age} jours</p>}
          {lastImport && <p className="text-xs text-gris-texte">Dernier import : {lastImport.fichier}</p>}
          {user.role === "superadmin" && <Link href="/admin/clients#nouveau" className="mt-1 inline-block text-sm text-horizon hover:underline">+ Nouveau client</Link>}
        </div>
      </div>

      <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Volume 12 mois" valeur={fmtEurCompact(kpis.volume12)} sous={<>dont confirmé {fmtEurCompact(kpis.confirme12)}</>}
          definition="Somme du « Total du dossier » des 365 derniers jours avant la date de référence, hors dossiers annulés (devis et demandes inclus). Confirmé : statuts Validée, Enregistrée, En Cours, Attente règlement. Source : export dossiers SpeedResa." />
        <Kpi label="Depuis janvier" valeur={ytdTxt} sous={<>{fmtEurCompact(kpis.ytd)} vs {fmtEurCompact(kpis.ytdN1)} en N-1</>}
          definition="Volume du 1er janvier à la date de référence, comparé à la même période de l'année précédente. Source : export dossiers SpeedResa." />
        <Kpi label="Clients critiques" valeur={kpis.critiques} accent={kpis.critiques ? "rouge" : undefined} sous={<>{kpis.surveiller} à surveiller</>}
          definition="Critique : au moins une alerte rouge (aucun dossier depuis 30 j, volume 90 j en baisse d'au moins 40 % sur un an, aucun dossier sur 12 mois). À surveiller : au moins une alerte orange. Règles : § 4 des règles de calcul." />
        <Kpi label="Potentiel capté" valeur={fmtPct(kpis.partCaptee, false, 1)} sous={<>sur {fmtEurCompact(kpis.vaTotal)} de VA estimé</>}
          definition="Volume 12 mois des clients dont le volume d'affaires global est estimé ÷ somme de ces estimations (onglet « VA annualisé »). L'estimation d'un groupe n'est comptée qu'une fois." />
        <Kpi label="Dépendance" valeur={fmtPct(kpis.premierGroupe?.part, false, 1)} sous={kpis.premierGroupe?.nom}
          definition="Part du volume 12 mois réalisée par le premier client (les comptes d'un même groupe sont additionnés)." />
        <Kpi label="Couverture d'audit" valeur={fmtPct(kpis.couvertureAudit)} sous={<>{kpis.audites} client{kpis.audites > 1 ? "s" : ""} audité{kpis.audites > 1 ? "s" : ""} &lt; 6 mois</>}
          definition="Part des clients dont le dernier audit finalisé date de moins de 6 mois (par rapport à la date des données)." />
      </section>

      {fileAFaire && <AFaire f={fileAFaire} portee={user.role === "superadmin" || !mesClients ? "Tout le portefeuille" : "Vos clients"} />}

      <PortfolioView rows={rows} userId={user.id} editable={canEdit(user)} csms={csms.filter((u) => u.role !== "lecture").map((u) => ({ id: u.id, nom: u.nom || u.email }))} />
    </div>
  );
}
