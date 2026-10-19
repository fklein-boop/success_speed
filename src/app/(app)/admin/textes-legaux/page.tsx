import { getDb } from "@/db";
import { referencesLegales, tousCriteres } from "@/lib/server/parametres";
import { REFERENCES_LEGALES, MENTION_JURIDIQUE } from "@/lib/restitution/textes";
import { FormAdmin } from "@/components/admin/FormAdmin";
import { majReferencesAction } from "../actions";

/** Références réglementaires des alertes légales (à faire valider par le juridique). */
export default async function TextesLegauxPage() {
  const db = await getDb();
  const [refs, cs] = await Promise.all([referencesLegales(db), tousCriteres(db)]);
  const legaux = cs.filter((c) => c.obligationLegale && c.actif);
  return (
    <FormAdmin action={majReferencesAction} bouton="Enregistrer les textes">
      <p className="mb-3 max-w-3xl text-sm text-gris-texte">Ces textes apparaissent dans les alertes légales envoyées aux clients (« Ce que prévoit la réglementation ») et dans le PDF de restitution. Ils sont toujours suivis de la mention : « {MENTION_JURIDIQUE} »</p>
      <div className="space-y-3">
        {legaux.map((c) => (
          <label key={c.id} className="carte flex flex-col gap-1 p-4">
            <span className="font-semibold">{c.id} — {c.critere}</span>
            <textarea name={`ref:${c.id}`} rows={3} defaultValue={refs[c.id] ?? ""} className="champ" />
            {REFERENCES_LEGALES[c.id] && refs[c.id] !== REFERENCES_LEGALES[c.id] && <span className="text-xs text-ambre">Texte modifié (origine : {REFERENCES_LEGALES[c.id]})</span>}
          </label>
        ))}
      </div>
    </FormAdmin>
  );
}
