import { getDb } from "@/db";
import { empreintes, lireParametre } from "@/lib/server/parametres";
import { BoutonAction, FormAdmin } from "@/components/admin/FormAdmin";
import { majEmpreintesAction, reinitialiserEmpreintesAction } from "../actions";

/** Empreintes du module SpeedResa et des solutions concurrentes (TECH-06, alerte « module disparu »). */
export default async function EmpreintesPage() {
  const db = await getDb();
  const e = await empreintes(db);
  const modifie = !!(await lireParametre(db, "empreintes"));
  const vides = (n: number) => Array.from({ length: n }, () => ({ nom: "", motif: "", force: "moyenne" }));
  const sr = [...e.speedresa, ...vides(3)], cc = [...e.concurrents, ...vides(5)];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-gris-texte">Un motif est un texte cherché (sans tenir compte de la casse) dans les scripts, iframes, formulaires et requêtes réseau de la page d&apos;accueil. Une empreinte SpeedResa « forte » suffit à conclure à la présence du module. Les concurrents ne sont cherchés que dans le code exécuté (pas dans les images). Pour supprimer une ligne, videz-la.</p>
        {modifie && <BoutonAction action={reinitialiserEmpreintesAction} label="Revenir au fichier d'origine" confirmation="Rétablir les empreintes de config/empreintes.json ?" />}
      </div>
      <FormAdmin action={majEmpreintesAction} bouton="Enregistrer les empreintes">
        <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="a_valider" defaultChecked={e.a_valider} className="size-4 accent-[#0A56FC]" /> Empreintes encore à valider par l&apos;équipe technique (mention ajoutée aux résultats TECH-06)</label>
        <div className="grid gap-4 lg:grid-cols-2">
          <fieldset className="carte p-4">
            <legend className="px-1 font-titres font-bold">Module SpeedResa</legend>
            <div className="space-y-2">{sr.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <input name={`sr.${i}.nom`} defaultValue={l.nom} placeholder="Nom" aria-label={`Nom de l'empreinte SpeedResa ${i + 1}`} className="champ" />
                <input name={`sr.${i}.motif`} defaultValue={l.motif} placeholder="Motif" aria-label={`Motif de l'empreinte SpeedResa ${i + 1}`} className="champ font-mono text-xs" />
                <select name={`sr.${i}.force`} defaultValue={l.force ?? "moyenne"} aria-label={`Force de l'empreinte ${i + 1}`} className="champ !w-auto"><option value="forte">forte</option><option value="moyenne">moyenne</option></select>
              </div>
            ))}</div>
          </fieldset>
          <fieldset className="carte p-4">
            <legend className="px-1 font-titres font-bold">Solutions concurrentes</legend>
            <div className="space-y-2">{cc.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <input name={`cc.${i}.nom`} defaultValue={l.nom} placeholder="Nom" aria-label={`Nom du concurrent ${i + 1}`} className="champ" />
                <input name={`cc.${i}.motif`} defaultValue={l.motif} placeholder="Motif" aria-label={`Motif du concurrent ${i + 1}`} className="champ font-mono text-xs" />
              </div>
            ))}</div>
          </fieldset>
        </div>
      </FormAdmin>
    </div>
  );
}
