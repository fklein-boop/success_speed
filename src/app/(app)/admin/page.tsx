import Link from "next/link";
import { Plus, Scale } from "lucide-react";
import { getDb } from "@/db";
import { tousCriteres } from "@/lib/server/parametres";
import { texteSeuil } from "@/lib/audit/valeur";

/** Référentiel des critères : modification (versionnée), désactivation, ajout. */
export default async function AdminCriteresPage() {
  const cs = await tousCriteres(await getDb());
  const actifs = cs.filter((c) => c.actif);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gris-texte">{actifs.length} critères actifs, {cs.length - actifs.length} désactivé(s), {actifs.reduce((s, c) => s + c.points, 0)} points. Chaque modification crée une nouvelle version : les audits passés gardent la version avec laquelle ils ont été évalués.</p>
        <Link href="/admin/criteres/nouveau" className="btn-primaire"><Plus size={15} aria-hidden /> Nouveau critère</Link>
      </div>
      <section className="carte overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr>{["ID", "Critère", "Pilier", "Source", "Pts", "Seuils", "Offre si NON", "Version", ""].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {cs.map((c) => (
              <tr key={c.id} className={`border-t border-gris-clair align-top ${c.actif ? "" : "text-gris-texte line-through decoration-gris-fonce/50"}`}>
                <td className="px-3 py-2 font-semibold whitespace-nowrap">{c.id}</td>
                <td className="px-3 py-2">{c.critere} {c.obligationLegale && <Scale size={12} className="inline text-rouge-texte" aria-label="obligation légale" />}</td>
                <td className="px-3 py-2 text-xs">{c.pilier}</td>
                <td className="px-3 py-2 text-xs whitespace-nowrap">{c.source}</td>
                <td className="px-3 py-2 tabular-nums">{c.points}</td>
                <td className="px-3 py-2 text-xs">{c.type === "Seuil" ? texteSeuil(c) : "Oui / Non"}</td>
                <td className="px-3 py-2 text-xs">{c.offreSiNon ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">v{c.version}{!c.actif && " (désactivé)"}</td>
                <td className="px-3 py-2"><Link href={`/admin/criteres/${c.id}`} className="text-horizon hover:underline">Modifier</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
