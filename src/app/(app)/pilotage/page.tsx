import Link from "next/link";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/server/auth";
import { filAlertes } from "@/lib/server/pilotage";
import { fmtDate } from "@/lib/format";
import { RisqueBadge } from "@/components/Badges";

const SOURCES: Record<string, string> = { donnees: "Données SpeedResa", audit: "Audit", scan: "Scan / monitoring" };

/** Fil des alertes de départ : ouvertes et récemment closes (60 jours). */
export default async function AlertesPage({ searchParams }: { searchParams: Promise<{ niveau?: string; source?: string; etat?: string; csm?: string }> }) {
  const user = await requireUser();
  const { niveau = "", source = "", etat = "ouvertes", csm = "" } = await searchParams;
  const db = await getDb();
  const [toutes, us] = await Promise.all([filAlertes(db), db.select({ id: users.id, nom: users.nom, email: users.email }).from(users)]);
  const liste = toutes.filter((a) => (!niveau || a.niveau === niveau) && (!source || a.source === source) && (etat === "toutes" || (etat === "ouvertes" ? !a.closeLe : !!a.closeLe)) && (!csm || String(a.csmId) === csm));
  const ouvertes = toutes.filter((a) => !a.closeLe);
  const semaine = Date.now() - 7 * 86_400_000;
  const kpi = [
    { l: "Alertes critiques ouvertes", v: ouvertes.filter((a) => a.niveau === "critique").length },
    { l: "À surveiller", v: ouvertes.filter((a) => a.niveau !== "critique").length },
    { l: "Nouvelles cette semaine", v: toutes.filter((a) => a.ouverteLe.getTime() > semaine).length },
    { l: "Closes cette semaine", v: toutes.filter((a) => a.closeLe && a.closeLe.getTime() > semaine).length },
  ];
  const nomU = (id: number | null) => { const u = us.find((x) => x.id === id); return u ? u.nom || u.email : "—"; };
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Synthèse des alertes">
        {kpi.map((k) => <div key={k.l} className="carte p-3"><p className="libelle">{k.l}</p><p className="font-titres text-3xl font-bold tabular-nums">{k.v}</p></div>)}
      </section>
      <form className="carte flex flex-wrap items-end gap-3 p-4" role="search">
        <label className="flex flex-col gap-1"><span className="libelle">Niveau</span><select name="niveau" defaultValue={niveau} className="champ w-40"><option value="">Tous</option><option value="critique">Critique</option><option value="surveiller">À surveiller</option></select></label>
        <label className="flex flex-col gap-1"><span className="libelle">Origine</span><select name="source" defaultValue={source} className="champ w-48"><option value="">Toutes</option>{Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="libelle">État</span><select name="etat" defaultValue={etat} className="champ w-40"><option value="ouvertes">Ouvertes</option><option value="closes">Closes (60 j)</option><option value="toutes">Toutes</option></select></label>
        <label className="flex flex-col gap-1"><span className="libelle">CSM</span><select name="csm" defaultValue={csm} className="champ w-48"><option value="">Tous</option><option value={String(user.id)}>Mes clients</option>{us.filter((u) => u.id !== user.id).map((u) => <option key={u.id} value={u.id}>{u.nom || u.email}</option>)}</select></label>
        <button className="btn-secondaire">Filtrer</button>
      </form>
      <section className="carte overflow-x-auto" aria-label="Fil des alertes">
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr>{["Ouverte le", "Client", "Niveau", "Alerte", "Origine", "CSM", "État"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {liste.map((a) => (
              <tr key={a.id} className="border-t border-gris-clair align-top">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDate(a.ouverteLe)}</td>
                <td className="px-3 py-2"><Link href={`/clients/${a.clientId}`} className="font-semibold text-horizon hover:underline">{a.nom}</Link></td>
                <td className="px-3 py-2"><RisqueBadge risque={a.niveau === "critique" ? "Critique" : "À surveiller"} /></td>
                <td className="px-3 py-2">{a.message}</td>
                <td className="px-3 py-2 whitespace-nowrap text-gris-texte">{SOURCES[a.source] ?? a.source}</td>
                <td className="px-3 py-2 whitespace-nowrap">{nomU(a.csmId)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{a.closeLe ? <span className="text-[#0b7a5e]">Close le {fmtDate(a.closeLe)}</span> : "Ouverte"}</td>
              </tr>
            ))}
            {!liste.length && <tr><td colSpan={7} className="px-3 py-6 text-center text-gris-texte">Aucune alerte pour ces filtres.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
