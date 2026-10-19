import type { Critere } from "@/lib/server/parametres";

/** Champs d'un critère (création ou nouvelle version). */
export function ChampsCritere({ c, piliers, sources, offres, nouveau }: { c: Partial<Critere>; piliers: string[]; sources: string[]; offres: string[]; nouveau?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {nouveau ? (
        <label className="flex flex-col gap-1"><span className="libelle">Identifiant</span><input name="id" required placeholder="VIS-09" pattern="[A-Za-z]{2,5}-\d{2}" className="champ" /></label>
      ) : <input type="hidden" name="id" value={c.id} />}
      <label className="flex flex-col gap-1"><span className="libelle">Pilier</span>
        <input name="pilier" list="piliers" defaultValue={c.pilier} required className="champ" /><datalist id="piliers">{piliers.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1 md:col-span-2"><span className="libelle">Critère</span><textarea name="critere" rows={2} defaultValue={c.critere} required className="champ" /></label>
      <label className="flex flex-col gap-1 md:col-span-2"><span className="libelle">Comment vérifier</span><textarea name="commentVerifier" rows={2} defaultValue={c.commentVerifier ?? ""} className="champ" /></label>
      <label className="flex flex-col gap-1"><span className="libelle">Source</span>
        <input name="source" list="sources" defaultValue={c.source} required className="champ" /><datalist id="sources">{sources.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1"><span className="libelle">Points</span><input name="points" type="number" min={0} max={50} defaultValue={c.points ?? 5} required className="champ" /></label>
      <label className="flex flex-col gap-1"><span className="libelle">Type</span><select name="type" defaultValue={c.type ?? "Oui/Non"} className="champ"><option>Oui/Non</option><option>Seuil</option></select></label>
      <label className="flex flex-col gap-1"><span className="libelle">Unité (critères à seuil)</span><input name="unite" defaultValue={c.unite ?? ""} placeholder="%, j, note /5…" className="champ" /></label>
      <label className="flex flex-col gap-1"><span className="libelle">Sens (critères à seuil)</span><select name="sens" defaultValue={c.sens ?? "↑"} className="champ"><option value="↑">↑ plus c&apos;est haut, mieux c&apos;est</option><option value="↓">↓ plus c&apos;est bas, mieux c&apos;est</option></select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1"><span className="libelle">Seuil plein (OUI)</span><input name="seuilPlein" inputMode="decimal" defaultValue={c.seuilPlein ?? ""} className="champ" /></label>
        <label className="flex flex-col gap-1"><span className="libelle">Seuil 50 %</span><input name="seuilMoitie" inputMode="decimal" defaultValue={c.seuilMoitie ?? ""} className="champ" /></label>
      </div>
      <p className="text-xs text-gris-texte md:col-span-2">Les pourcentages se saisissent en fraction (0,8 pour 80 %), comme dans le référentiel.</p>
      <label className="flex flex-col gap-1"><span className="libelle">Offre Speedmedia si NON</span>
        <input name="offreSiNon" list="offres" defaultValue={c.offreSiNon ?? ""} className="champ" /><datalist id="offres">{offres.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1"><span className="libelle">Question pour le client</span><input name="questionClient" defaultValue={c.questionClient ?? ""} className="champ" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="obligationLegale" defaultChecked={!!c.obligationLegale} className="size-4 accent-[#0A56FC]" /> Obligation légale</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="actif" defaultChecked={c.actif ?? true} className="size-4 accent-[#0A56FC]" /> Actif (décocher pour désactiver le critère)</label>
    </div>
  );
}
