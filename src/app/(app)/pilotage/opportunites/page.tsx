import Link from "next/link";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { opportunites } from "@/lib/server/pilotage";
import { STATUT_ACTION_LIBELLE, type StatutAction } from "@/lib/server/restitution";

/** Opportunités consolidées (données SpeedResa + plans d'action d'audit), pour la planification commerciale. */
export default async function OpportunitesPage({ searchParams }: { searchParams: Promise<{ type?: string; offre?: string; source?: string; csm?: string }> }) {
  const { type = "", offre = "", source = "", csm = "" } = await searchParams;
  const db = await getDb();
  const [toutes, us] = await Promise.all([opportunites(db), db.select({ id: users.id, nom: users.nom, email: users.email }).from(users)]);
  const types = [...new Set(toutes.map((o) => o.type))].sort();
  const offres = [...new Set(toutes.map((o) => o.offre).filter((x): x is string => !!x))].sort();
  const liste = toutes.filter((o) => (!type || o.type === type) && (!offre || o.offre === offre) && (!source || o.source === source) && (!csm || String(o.csmId) === csm));
  const parOffre = new Map<string, number>();
  for (const o of toutes) if (o.offre) parOffre.set(o.offre, (parOffre.get(o.offre) ?? 0) + 1);
  return (
    <div className="space-y-4">
      <section className="carte p-4" aria-labelledby="offres-titre">
        <h2 id="offres-titre" className="text-lg">Offres les plus demandées par les plans d&apos;action</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {[...parOffre].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([o, n]) => <Link key={o} href={`?offre=${encodeURIComponent(o)}`} className="rounded-full bg-gris-clair px-3 py-1 text-sm hover:bg-horizon/10">{o} <strong>{n}</strong></Link>)}
          {!parOffre.size && <p className="text-sm text-gris-texte">Aucun plan d&apos;action créé pour l&apos;instant.</p>}
        </div>
      </section>
      <form className="carte flex flex-wrap items-end gap-3 p-4" role="search">
        <label className="flex flex-col gap-1"><span className="libelle">Type</span><select name="type" defaultValue={type} className="champ w-56"><option value="">Tous</option>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="libelle">Offre</span><select name="offre" defaultValue={offre} className="champ w-64"><option value="">Toutes</option>{offres.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="libelle">Origine</span><select name="source" defaultValue={source} className="champ w-40"><option value="">Toutes</option><option value="données">Données</option><option value="audit">Audit</option></select></label>
        <label className="flex flex-col gap-1"><span className="libelle">CSM</span><select name="csm" defaultValue={csm} className="champ w-48"><option value="">Tous</option>{us.map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}</select></label>
        <button className="btn-secondaire">Filtrer</button>
        <span className="pb-2 text-sm text-gris-texte">{liste.length} opportunité(s)</span>
      </form>
      <section className="carte overflow-x-auto" aria-label="Liste des opportunités">
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr>{["Client", "Type", "Détail", "Offre", "Origine", "Statut"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {liste.map((o, i) => (
              <tr key={i} className="border-t border-gris-clair align-top">
                <td className="px-3 py-2"><Link href={`/clients/${o.clientId}`} className="font-semibold text-horizon hover:underline">{o.nom}</Link></td>
                <td className="px-3 py-2 whitespace-nowrap">{o.type}</td>
                <td className="px-3 py-2">{o.detail}</td>
                <td className="px-3 py-2 font-semibold text-horizon">{o.offre ?? "—"}</td>
                <td className="px-3 py-2">{o.source}</td>
                <td className="px-3 py-2 whitespace-nowrap">{o.statut ? STATUT_ACTION_LIBELLE[o.statut as StatutAction] ?? o.statut : "—"}</td>
              </tr>
            ))}
            {!liste.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-gris-texte">Aucune opportunité pour ces filtres.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
