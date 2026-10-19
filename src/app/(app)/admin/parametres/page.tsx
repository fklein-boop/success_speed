import { getDb } from "@/db";
import { getMetricsParams } from "@/lib/server/recompute";
import { lireParametre } from "@/lib/server/parametres";
import { DEFAULT_METRICS_PARAMS } from "@/lib/metrics/params";
import { GROUPES_PARAMS, versSaisie } from "@/lib/metrics/libelles";
import { BoutonAction, FormAdmin } from "@/components/admin/FormAdmin";
import { majParametresAction, reinitialiserParametresAction } from "../actions";

const UNITE: Record<string, string> = { "%": "%", "€": "€", jours: "jours", pts: "pts", nb: "" };

/** Seuils et poids du score santé, des alertes et des opportunités (02_REGLES_DE_CALCUL.md). */
export default async function ParametresPage() {
  const db = await getDb();
  const p = await getMetricsParams(db);
  const modifie = !!(await lireParametre(db, "metrics"));
  const val = (cle: string, k: string, src: unknown) => (cle ? (src as Record<string, Record<string, number>>)[cle][k] : (src as Record<string, number>)[k]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-gris-texte">À l&apos;enregistrement, tout le portefeuille est recalculé (indicateurs, scores santé, alertes, opportunités). Les valeurs d&apos;origine sont rappelées sous chaque champ modifié. Attention : la recette de non-régression est établie avec les valeurs d&apos;origine.</p>
        {modifie && <BoutonAction action={reinitialiserParametresAction} label="Revenir aux valeurs d'origine" confirmation="Rétablir toutes les valeurs d'origine et recalculer le portefeuille ?" />}
      </div>
      <FormAdmin action={majParametresAction} bouton="Enregistrer et recalculer">
        <div className="grid gap-4 lg:grid-cols-2">
          {GROUPES_PARAMS.map((g) => (
            <fieldset key={g.titre} className="carte p-4">
              <legend className="px-1 font-titres font-bold">{g.titre}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.params.map(([k, libelle, unite]) => {
                  const actuel = versSaisie(val(g.cle, k, p), unite), origine = versSaisie(val(g.cle, k, DEFAULT_METRICS_PARAMS), unite);
                  return (
                    <label key={k} className="flex flex-col gap-1">
                      <span className="text-sm">{libelle}</span>
                      <span className="flex items-center gap-2"><input name={`${g.cle}.${k}`} inputMode="decimal" defaultValue={String(actuel).replace(".", ",")} required className="champ !w-32 tabular-nums" /><span className="text-sm text-gris-texte">{UNITE[unite]}</span></span>
                      {actuel !== origine && <span className="text-xs text-ambre">Origine : {String(origine).replace(".", ",")} {UNITE[unite]}</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </FormAdmin>
    </div>
  );
}
