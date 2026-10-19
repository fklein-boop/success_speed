import { FormAdmin } from "./FormAdmin";
import { creerClientAction } from "@/app/(app)/admin/actions";

/** Formulaire « Nouveau client » (identifiant SpeedResa, ou provisoire NC01… s'il n'est pas encore connu). */
export function NouveauClientForm({ groupes, modeles, csms }: { groupes: string[]; modeles: string[]; csms: { id: number; nom: string }[] }) {
  return (
    <FormAdmin action={creerClientAction} bouton="Créer le client">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1"><span className="libelle">IDagence SpeedResa</span><input name="id" placeholder="ex. A40 — vide : identifiant provisoire" className="champ uppercase" /></label>
        <label className="flex flex-col gap-1 md:col-span-2"><span className="libelle">Nom</span><input name="nom" required minLength={2} className="champ" /></label>
        <label className="flex flex-col gap-1"><span className="libelle">Groupe</span><input name="groupe" list="nc-groupes" placeholder="Aucun, ou nom d'un groupe" className="champ" /><datalist id="nc-groupes">{groupes.map((g) => <option key={g} value={g} />)}</datalist></label>
        <label className="flex flex-col gap-1"><span className="libelle">Modèle de distribution</span><input name="modele" list="nc-modeles" className="champ" /><datalist id="nc-modeles">{modeles.map((g) => <option key={g} value={g} />)}</datalist></label>
        <label className="flex flex-col gap-1"><span className="libelle">Site web</span><input name="url" placeholder="https://www.agence.fr" className="champ" /></label>
        <label className="flex flex-col gap-1"><span className="libelle">CSM attitré</span><select name="csmId" className="champ"><option value="">— Aucun —</option>{csms.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></label>
        <label className="flex flex-col gap-1"><span className="libelle">Email de contact client</span><input name="emailContact" type="email" className="champ" /></label>
        <label className="flex flex-col gap-1"><span className="libelle">VA global estimé (€)</span><input name="vaGlobalEstime" inputMode="numeric" className="champ" /></label>
        <label className="flex items-center gap-2 text-sm md:col-span-3"><input type="checkbox" name="vaCompteeDansTotaux" defaultChecked className="size-4 accent-[#0A56FC]" /> VA estimé compté dans les totaux (décochez pour un compte secondaire d&apos;un groupe)</label>
      </div>
      <p className="mt-2 text-xs text-gris-texte">Sans dossiers, le client n&apos;est pas noté (pas d&apos;alerte « aucun dossier ») : on peut déjà l&apos;auditer. Si vous utilisez un identifiant provisoire, rattachez son vrai IDagence lors de l&apos;import du lundi (« Rattacher à… » dans l&apos;aperçu).</p>
    </FormAdmin>
  );
}
