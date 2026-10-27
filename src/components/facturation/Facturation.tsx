"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Download, Settings } from "lucide-react";
import { lignesFacture, libelleMois, tableEnTexte, type TableProduction, type Tarifs } from "@/lib/facturation/calcul";
import type { AgenceFacturee } from "@/lib/server/facturation";
import { FormAdmin } from "@/components/admin/FormAdmin";
import { reglagesFacturationAction } from "@/app/(app)/facturation/actions";

interface Props { f: { mois: string; debut: string; fin: string; donneesJusquau: string | null; complet: boolean; tarifs: Tarifs; production: TableProduction; agences: AgenceFacturee[] } }

const eur = (x: number) => x.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const n0 = (x: number) => Math.round(x).toLocaleString("fr-FR");
const fr = (iso: string) => iso.split("-").reverse().join("/");

/** Choix des comptes et aperçu des lignes de facture (une facture unique pour plusieurs comptes d'un même client). */
export function Facturation({ f }: Props) {
  const router = useRouter();
  const [choix, setChoix] = useState<Set<string>>(new Set());
  const [filtre, setFiltre] = useState("");
  const [copie, setCopie] = useState(false);
  const [reglages, setReglages] = useState(false);
  const selection = f.agences.filter((a) => choix.has(a.idAgence));
  const lignes = useMemo(() => lignesFacture(selection, f.tarifs), [selection, f.tarifs]);
  const total = lignes.reduce((s, l) => s + l.montant, 0);
  const visibles = f.agences.filter((a) => `${a.idAgence} ${a.nom} ${a.groupe ?? ""}`.toLowerCase().includes(filtre.toLowerCase()));
  const groupesSel = [...new Set(selection.map((a) => a.groupe).filter((g): g is string => !!g))];
  const basculer = (id: string) => setChoix((s) => { const t = new Set(s); if (t.has(id)) t.delete(id); else t.add(id); return t; });
  const ajouterGroupe = (g: string) => setChoix((s) => new Set([...s, ...f.agences.filter((a) => a.groupe === g).map((a) => a.idAgence)]));
  const texte = [`Facturation ${libelleMois(f.mois)} — ${selection.map((a) => `${a.nom} (${a.idAgence})`).join(", ")}`,
    ...lignes.map((l) => `${l.designation}\t${l.code === "externe" ? "1" : n0(l.quantite)}\t${l.prixUnitaire.toFixed(2).replace(".", ",")} €\t${l.montant.toFixed(2).replace(".", ",")} € HT${l.detail ? `\n  ${l.detail}` : ""}`),
    `Total frais variables : ${total.toFixed(2).replace(".", ",")} € HT`].join("\n");

  return (
    <div className="space-y-6">
      <section className="carte flex flex-wrap items-center gap-4 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold">Mois facturé
          <input type="month" value={f.mois} max={new Date().toISOString().slice(0, 7)} onChange={(e) => e.target.value && router.push(`/facturation?mois=${e.target.value}`)} className="champ w-auto" />
        </label>
        <span className="text-sm text-gris-texte">Dossiers réservés du {fr(f.debut)} au {fr(f.fin)} · {f.agences.length} compte(s) avec de l&apos;activité</span>
        {!f.complet && <span className="inline-flex items-center gap-1 text-sm font-semibold text-rouge-texte"><AlertTriangle size={14} aria-hidden /> Données jusqu&apos;au {f.donneesJusquau ? fr(f.donneesJusquau) : "—"} seulement : importez l&apos;export couvrant tout le mois.</span>}
        <span className="ml-auto flex gap-2">
          <a href={`/api/facturation?mois=${f.mois}`} className="btn-secondaire"><Download size={14} aria-hidden /> Tous les comptes (CSV)</a>
          <button className="btn-discret" onClick={() => setReglages((x) => !x)} aria-expanded={reglages}><Settings size={14} aria-hidden /> Réglages</button>
        </span>
      </section>

      {reglages && (
        <section className="carte p-4" aria-labelledby="reglages-titre">
          <h2 id="reglages-titre" className="text-lg">Réglages de facturation</h2>
          <FormAdmin action={reglagesFacturationAction} bouton="Enregistrer les réglages">
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">Demande / devis (€ par pax)<input name="demande" defaultValue={String(f.tarifs.demande).replace(".", ",")} className="champ w-20" /></label>
              <label className="flex items-center gap-2">RésaLive production interne (€ par pax)<input name="resaliveInterne" defaultValue={String(f.tarifs.resaliveInterne).replace(".", ",")} className="champ w-20" /></label>
              <label className="flex items-center gap-2">RésaLive hors production (% du CA)<input name="resaliveExterne" defaultValue={String(f.tarifs.resaliveExterne * 100).replace(".", ",")} className="champ w-20" /></label>
            </div>
            <label className="mt-3 block text-sm font-semibold">Table de production : « IDagence ; mot-clé du fournisseur », une ligne par mot-clé (colonnes T:U de la matrice)
              <textarea name="production" rows={8} defaultValue={tableEnTexte(f.production)} className="champ mt-1 font-mono text-xs" />
            </label>
            <p className="mt-1 text-xs text-gris-texte">Un dossier RésaLive est « production interne » si le nom du fournisseur contient un mot-clé de l&apos;agence. Une agence absente de la table n&apos;a pas de production interne : tout son RésaLive OK est compté hors production.</p>
          </FormAdmin>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section className="carte p-4" aria-labelledby="comptes-titre">
          <h2 id="comptes-titre" className="text-lg">Comptes à facturer</h2>
          <input value={filtre} onChange={(e) => setFiltre(e.target.value)} placeholder="Filtrer (nom, IDagence, groupe)" aria-label="Filtrer les comptes" className="champ mt-2" />
          {groupesSel.map((g) => <button key={g} className="btn-discret mt-2 text-xs" onClick={() => ajouterGroupe(g)}>+ tous les comptes du groupe « {g} »</button>)}
          <ul className="mt-2 max-h-[60vh] divide-y divide-gris-clair overflow-y-auto">
            {visibles.map((a) => {
              const fees = (a.demandes + a.resaliveKo) * f.tarifs.demande + a.prodPax * f.tarifs.resaliveInterne + a.horsProdCa * f.tarifs.resaliveExterne;
              return (
                <li key={a.idAgence}>
                  <label className="flex cursor-pointer items-center gap-3 py-1.5 text-sm">
                    <input type="checkbox" checked={choix.has(a.idAgence)} onChange={() => basculer(a.idAgence)} />
                    <span className="min-w-0 flex-1"><span className="font-semibold">{a.nom}</span> <span className="text-xs text-gris-texte">{a.idAgence}{a.groupe ? ` · ${a.groupe}` : ""}</span>
                      <span className="block text-xs text-gris-texte">{n0(a.demandes + a.resaliveKo)} demandes · RésaLive {n0(a.prodPax)} pax prod{a.horsProdCa ? ` · ${eur(a.horsProdCa)} hors prod` : ""}</span></span>
                    <span className="tabular-nums">{eur(fees)}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="carte p-4" aria-labelledby="facture-titre">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="facture-titre" className="text-lg">Frais variables — {libelleMois(f.mois)}</h2>
            {lignes.length > 0 && <button className="btn-secondaire" onClick={async () => { try { await navigator.clipboard.writeText(texte); setCopie(true); setTimeout(() => setCopie(false), 2000); } catch { setCopie(false); } }}>{copie ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copie ? "Copié" : "Copier les lignes"}</button>}
          </div>
          {!selection.length ? <p className="mt-3 text-sm text-gris-texte">Cochez un ou plusieurs comptes : les lignes de la facture s&apos;affichent ici.</p> : (
            <>
              <p className="mt-1 text-sm text-gris-texte">{selection.map((a) => `${a.nom} (${a.idAgence})`).join(", ")}</p>
              {lignes.length ? (
                <table className="mt-3 w-full text-sm">
                  <thead className="text-left text-xs text-gris-texte"><tr><th className="py-1 font-semibold">Produit</th><th className="py-1 text-right font-semibold">Qté</th><th className="py-1 text-right font-semibold">Prix u. HT</th><th className="py-1 text-right font-semibold">Total HT</th></tr></thead>
                  <tbody>
                    {lignes.map((l) => (
                      <tr key={l.code} className="border-t border-gris-clair align-top">
                        <td className="py-2 pr-3"><p className="font-semibold">{l.designation}</p>{l.detail && <p className="text-xs text-gris-texte">{l.detail}</p>}</td>
                        <td className="py-2 text-right tabular-nums">{l.code === "externe" ? "1" : `${n0(l.quantite)} ${l.unite}`}</td>
                        <td className="py-2 text-right tabular-nums">{eur(l.prixUnitaire)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{eur(l.montant)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-minuit"><td colSpan={3} className="py-2 font-semibold">Total frais variables</td><td className="py-2 text-right font-titres text-lg font-bold tabular-nums">{eur(total)}</td></tr>
                  </tbody>
                </table>
              ) : <p className="mt-3 text-sm">Aucun frais variable sur ce mois.</p>}
              {selection.some((a) => !a.production && a.resaliveOkPax > 0) && <p className="mt-2 rounded bg-ambre/15 p-2 text-xs">Un compte sélectionné vend en RésaLive sans production interne déclarée : son CA est compté hors production (1 %). Vérifiez la table de production si besoin.</p>}
              <p className="mt-2 text-xs text-gris-texte">Abonnements, modules et remises ne sont pas calculés ici : à ajouter dans l&apos;outil de facturation.</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
