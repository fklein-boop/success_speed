import Link from "next/link";
import { getDb } from "@/db";
import { groupes, users } from "@/db/schema";
import { referentielClients } from "@/lib/server/clients-admin";
import { NouveauClientForm } from "@/components/admin/NouveauClientForm";
import { ActiverClient } from "@/components/admin/ActiverClient";

/** Référentiel clients : création, groupe, modèle, activation. */
export default async function ClientsAdminPage() {
  const db = await getDb();
  const [liste, gs, us] = await Promise.all([referentielClients(db), db.select().from(groupes), db.select({ id: users.id, nom: users.nom, email: users.email, role: users.role }).from(users)]);
  const modeles = [...new Set(liste.map((c) => c.modele).filter((x): x is string => !!x))].sort();
  return (
    <div className="space-y-6">
      <section className="carte p-4" id="nouveau" aria-labelledby="nouveau-titre">
        <h2 id="nouveau-titre" className="mb-3 text-lg">Nouveau client</h2>
        <NouveauClientForm groupes={gs.map((g) => g.nom).sort()} modeles={modeles} csms={us.filter((u) => u.role !== "lecture").map((u) => ({ id: u.id, nom: u.nom || u.email }))} />
      </section>
      <section className="carte overflow-x-auto" aria-label="Référentiel des clients">
        <p className="p-4 text-sm text-gris-texte">{liste.filter((c) => c.actif).length} clients actifs, {liste.filter((c) => !c.actif).length} désactivé(s). Groupe, modèle et VA se modifient aussi sur chaque fiche client.</p>
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr>{["ID", "Client", "Groupe", "Modèle", "CSM", "Dossiers", "État", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {liste.map((c) => (
              <tr key={c.id} className={`border-t border-gris-clair ${c.actif ? "" : "text-gris-texte"}`}>
                <td className="px-3 py-1.5 font-semibold">{c.id}</td>
                <td className="px-3 py-1.5"><Link href={`/clients/${c.id}`} className="text-horizon hover:underline">{c.nom}</Link></td>
                <td className="px-3 py-1.5">{c.groupe ?? "—"}{c.groupe && !c.vaCompteeDansTotaux && <span className="ml-1 text-xs text-gris-texte">(secondaire)</span>}</td>
                <td className="px-3 py-1.5 text-xs">{c.modele ?? "—"}</td>
                <td className="px-3 py-1.5">{c.csm ?? "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{c.dossiers.toLocaleString("fr-FR")}</td>
                <td className="px-3 py-1.5 text-xs">{!c.actif ? "désactivé" : c.horsExport ? "sans dossiers (non noté)" : "actif"}</td>
                <td className="px-3 py-1.5"><ActiverClient id={c.id} nom={c.nom} actif={c.actif} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
