import { Scale } from "lucide-react";
import { getDb } from "@/db";
import { requireUser } from "@/lib/server/auth";
import { loadCriteres } from "@/lib/server/audits";
import { texteSeuil } from "@/lib/audit/valeur";

export default async function CriteresPage({ searchParams }: { searchParams: Promise<{ source?: string; legal?: string; q?: string }> }) {
  await requireUser();
  const { source = "", legal = "", q = "" } = await searchParams;
  const all = await loadCriteres(await getDb());
  const sources = [...new Set(all.map((c) => c.source))].sort();
  const nq = q.trim().toLowerCase();
  const list = all.filter((c) => (!source || c.source === source) && (!legal || c.obligationLegale) && (!nq || `${c.id} ${c.critere} ${c.offreSiNon ?? ""}`.toLowerCase().includes(nq)));
  const piliers = [...new Set(list.map((c) => c.pilier))];
  const total = all.reduce((s, c) => s + c.points, 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Référentiel des critères</h1>
        <p className="mt-1 text-gris-texte">{all.length} critères, {piliers.length === 0 ? 0 : new Set(all.map((c) => c.pilier)).size} piliers, {total} points. Le super admin modifie les critères, seuils et poids dans Administration.</p>
      </div>
      <form className="carte flex flex-wrap items-end gap-3 p-4" role="search">
        <label className="flex flex-col gap-1"><span className="libelle">Recherche</span><input name="q" defaultValue={q} className="champ w-64" placeholder="ID, critère, offre…" /></label>
        <label className="flex flex-col gap-1"><span className="libelle">Source</span>
          <select name="source" defaultValue={source} className="champ w-52"><option value="">Toutes</option>{sources.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="legal" value="1" defaultChecked={!!legal} className="size-4 accent-[#0A56FC]" /> Obligations légales uniquement</label>
        <button className="btn-secondaire">Filtrer</button>
      </form>
      {piliers.map((p) => {
        const cs = list.filter((c) => c.pilier === p);
        return (
          <section key={p} className="carte overflow-x-auto" aria-labelledby={`p-${p}`}>
            <h2 id={`p-${p}`} className="border-b border-gris-clair p-4 text-lg">{p} <span className="text-sm font-normal text-gris-texte">({cs.reduce((s, c) => s + c.points, 0)} pts)</span></h2>
            <table className="w-full text-sm">
              <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte">
                <tr>{["ID", "Critère", "Source", "Pts", "Seuils", "Offre si NON", "Question client"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {cs.map((c) => (
                  <tr key={c.id} className="border-t border-gris-clair align-top">
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">{c.id}</td>
                    <td className="px-3 py-2">
                      {c.critere} {c.obligationLegale && <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-rouge/10 px-2 text-xs font-semibold text-rouge-texte"><Scale size={11} aria-hidden />légal</span>}
                      {c.commentVerifier && <p className="text-xs text-gris-texte">Vérifier : {c.commentVerifier}</p>}
                      {c.detectionAuto && <details className="text-xs"><summary className="cursor-pointer text-horizon">Détection automatique</summary><p className="mt-1 text-gris-texte">{c.detectionAuto}</p></details>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.source}</td>
                    <td className="px-3 py-2 tabular-nums">{c.points}</td>
                    <td className="px-3 py-2 text-xs">{c.type === "Seuil" ? texteSeuil(c) : "Oui / Non"}</td>
                    <td className="px-3 py-2">{c.offreSiNon ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-gris-texte">{c.questionClient ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>
  );
}
