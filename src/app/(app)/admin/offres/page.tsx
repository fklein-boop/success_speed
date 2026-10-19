import { getDb } from "@/db";
import { effortsOffres } from "@/lib/server/restitution";
import { tousCriteres } from "@/lib/server/parametres";
import offresConfig from "../../../../../config/offres.json";
import { FormAdmin } from "@/components/admin/FormAdmin";
import { majEffortsAction } from "../actions";

/** Effort de chaque offre Speedmedia : sert à prioriser les plans d'action (impact ÷ effort). */
export default async function OffresPage() {
  const db = await getDb();
  const [efforts, cs] = await Promise.all([effortsOffres(db), tousCriteres(db)]);
  const defaut = offresConfig.efforts as Record<string, string>;
  const offres = [...new Set([...Object.keys(defaut), ...cs.map((c) => c.offreSiNon).filter((x): x is string => !!x)])].sort((a, b) => a.localeCompare(b, "fr"));
  return (
    <FormAdmin action={majEffortsAction} bouton="Enregistrer les efforts">
      <p className="mb-3 text-sm text-gris-texte">Effort faible = 1, moyen = 2, fort = 3. La priorité d&apos;une action = impact ÷ effort. Les nouveaux plans d&apos;action utilisent ces valeurs.</p>
      <section className="carte overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gris-clair/50 text-left text-xs text-gris-texte"><tr><th className="px-3 py-2 font-semibold">Offre</th><th className="px-3 py-2 font-semibold">Critères concernés</th><th className="px-3 py-2 font-semibold">Effort</th></tr></thead>
          <tbody>
            {offres.map((o) => (
              <tr key={o} className="border-t border-gris-clair">
                <td className="px-3 py-1.5">{o}</td>
                <td className="px-3 py-1.5 text-xs text-gris-texte">{cs.filter((c) => c.offreSiNon === o).map((c) => c.id).join(", ")}</td>
                <td className="px-3 py-1.5">
                  <label className="sr-only" htmlFor={`e-${o}`}>Effort de « {o} »</label>
                  <select id={`e-${o}`} name={`effort:${o}`} defaultValue={efforts[o] ?? "moyen"} className="champ !w-auto !py-1">
                    <option value="faible">faible</option><option value="moyen">moyen</option><option value="fort">fort</option>
                  </select>
                  {defaut[o] && efforts[o] !== defaut[o] && <span className="ml-2 text-xs text-ambre">origine : {defaut[o]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </FormAdmin>
  );
}
