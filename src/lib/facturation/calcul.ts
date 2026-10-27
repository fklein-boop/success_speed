/**
 * Facturation des commissions mensuelles (frais variables), reprise de la matrice Excel « Matrice_factu.xlsx »
 * (cellules P1:Q10) et vérifiée sur les factures de septembre 2026. Module pur.
 *
 * Par agence, sur les dossiers dont la date de réservation tombe dans le mois facturé :
 * - Demandes (pax) = dossiers non producteurs d'origine « Demande de réservation » + dossiers (producteur ≠ oui) d'origine « Commande » ;
 * - RésaLive KO (pax) = dossiers non producteurs d'origine « RésaLive » avec erreur RésaLive ;
 * - RésaLive OK (pax, CA) = dossiers non producteurs d'origine « RésaLive » sans erreur ;
 *   dont « production interne » quand le fournisseur contient un mot-clé de l'agence (table de production), le reste « hors production ».
 * Lignes de facture :
 * - « Fees Devis et Demandes de résa » = (Demandes + RésaLive KO) × 0,50 € ;
 * - « Fees Résalive Prod interne » = RésaLive OK production interne (pax) × 2,00 € ;
 * - « Fees Resalive Prod externe (1 %) » = 1 % du CA RésaLive OK hors production.
 * Une agence absente de la table de production n'a pas de production interne : tout son RésaLive OK est « hors production »
 * (la matrice affichait « N/A » ; à confirmer au cas par cas, ex. remise en fees 2 €/pax).
 */
import type { DossierImport } from "@/lib/import/dossiers";

export interface Tarifs { demande: number; resaliveInterne: number; resaliveExterne: number }
export const TARIFS_DEFAUT: Tarifs = { demande: 0.5, resaliveInterne: 2, resaliveExterne: 0.01 };

/** Table de production : IDagence → mots-clés contenus dans le nom du fournisseur (colonnes T:U de la matrice) */
export type TableProduction = Record<string, string[]>;
const QL = ["QUARTIER LIBRE", "QL VOYAGE", "BOURSE DES VOYAGES"];
export const PRODUCTION_DEFAUT: TableProduction = {
  B06: QL, C03: ["OLLANDINI"], C20: ["CORSICATOURS", "CANNELLE"], C24: ["CANNELLE"], D09: ["PERIER"], E16: ["EGYPT NILE CRUISES"],
  H03: ["HANGARD"], K07: ["KOSMO"], M26: ["MND"], N03: ["NEWTOUR"], P17: ["PERIER"], P33: ["PANTHEON"],
  Q01: QL, Q03: QL, Q07: QL, Q08: QL, Q09: QL, R12: ["ROYER"], R15: ["EUROPA", "DÉSIRS2RÊVES"], R16: ["EUROPA", "DÉSIRS2RÊVES"],
  T13: ["TRAVEL EVASION"], T39: ["TOP OF TRAVEL"],
};

export type LigneDossier = Pick<DossierImport, "idAgence" | "producteur" | "pax" | "origine" | "erreurResalive" | "fournisseur" | "total" | "date">;

export interface SyntheseAgence {
  idAgence: string;
  demandes: number;
  resaliveKo: number;
  resaliveOkPax: number;
  resaliveOkCa: number;
  /** true si l'agence figure dans la table de production */
  production: boolean;
  prodPax: number;
  prodCa: number;
  horsProdPax: number;
  horsProdCa: number;
}

const majus = (s: string | null) => (s ?? "").toUpperCase();

/** Synthèse d'une agence (cellules Q4:Q10 de la matrice). */
export function syntheseAgence(idAgence: string, lignes: LigneDossier[], table: TableProduction): SyntheseAgence {
  const motsCles = table[idAgence];
  const s: SyntheseAgence = { idAgence, demandes: 0, resaliveKo: 0, resaliveOkPax: 0, resaliveOkCa: 0, production: !!motsCles?.length, prodPax: 0, prodCa: 0, horsProdPax: 0, horsProdCa: 0 };
  for (const d of lignes) {
    if (d.idAgence !== idAgence) continue;
    const pax = d.pax ?? 0;
    // « Producteur » : « non » pour les demandes et RésaLive, « ≠ oui » pour les commandes (même règle avec un booléen)
    if (d.producteur) continue;
    if (d.origine === "Demande de réservation" || d.origine === "Commande") s.demandes += pax;
    else if (d.origine === "RésaLive") {
      if (d.erreurResalive) s.resaliveKo += pax;
      else {
        s.resaliveOkPax += pax; s.resaliveOkCa += d.total;
        const interne = !!motsCles?.some((k) => majus(d.fournisseur).includes(k.toUpperCase()));
        if (interne) { s.prodPax += pax; s.prodCa += d.total; } else { s.horsProdPax += pax; s.horsProdCa += d.total; }
      }
    }
  }
  return s;
}

export interface LigneFacture { code: "demandes" | "interne" | "externe"; designation: string; detail: string; quantite: number; unite: string; prixUnitaire: number; montant: number }

const n0 = (x: number) => Math.round(x).toLocaleString("fr-FR");
const eur = (x: number) => x.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const arrondi = (x: number) => Math.round(x * 100) / 100;

/**
 * Lignes de facture pour une sélection d'agences (une facture unique pour un client multi-comptes, ex. Quartier Libre, APAS).
 * Le détail par compte n'apparaît que s'il y a plusieurs agences.
 */
export function lignesFacture(agences: SyntheseAgence[], tarifs: Tarifs = TARIFS_DEFAUT): LigneFacture[] {
  const plusieurs = agences.filter((a) => a.demandes + a.resaliveKo + a.resaliveOkPax > 0).length > 1;
  const out: LigneFacture[] = [];
  const dem = agences.filter((a) => a.demandes + a.resaliveKo > 0);
  const qDem = dem.reduce((s, a) => s + a.demandes + a.resaliveKo, 0);
  if (qDem) out.push({
    code: "demandes", designation: "Fees Devis et Demandes de résa - FR",
    detail: plusieurs ? dem.map((a) => `${a.idAgence} : ${n0(a.demandes)} pax${a.resaliveKo ? ` + ${n0(a.resaliveKo)} pax resalive KO` : ""}`).join(" - ") : `${n0(dem[0].demandes)} pax${dem[0].resaliveKo ? ` + ${n0(dem[0].resaliveKo)} pax Resalive KO` : ""}`,
    quantite: qDem, unite: "unités", prixUnitaire: tarifs.demande, montant: arrondi(qDem * tarifs.demande),
  });
  const int = agences.filter((a) => a.prodPax > 0);
  const qInt = int.reduce((s, a) => s + a.prodPax, 0);
  if (qInt) out.push({
    code: "interne", designation: "Fees Résalive Prod interne - FR",
    detail: plusieurs ? int.map((a) => `${a.idAgence} : ${n0(a.prodPax)} pax`).join(" - ") : "",
    quantite: qInt, unite: "unités", prixUnitaire: tarifs.resaliveInterne, montant: arrondi(qInt * tarifs.resaliveInterne),
  });
  const ext = agences.filter((a) => a.horsProdCa > 0);
  const caExt = ext.reduce((s, a) => s + a.horsProdCa, 0);
  if (caExt) out.push({
    code: "externe", designation: `Fees Resalive Prod externe (${(tarifs.resaliveExterne * 100).toLocaleString("fr-FR")}%) - FR`,
    detail: `${ext.map((a) => `${plusieurs ? `${a.idAgence} : ` : ""}${n0(a.horsProdPax)} pax, ${eur(a.horsProdCa)} de CA${a.production ? "" : " (aucune production interne déclarée)"}`).join(" - ")}`,
    quantite: 1, unite: "", prixUnitaire: arrondi(caExt * tarifs.resaliveExterne), montant: arrondi(caExt * tarifs.resaliveExterne),
  });
  return out;
}

/** Mois facturé par défaut : le mois entier qui vient de s'écouler (AAAA-MM). */
export function moisPrecedent(maintenant = new Date()): string {
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}
export const bornesMois = (mois: string) => {
  const [y, m] = mois.split("-").map(Number);
  return { debut: `${mois}-01`, fin: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
};
export const libelleMois = (mois: string) => new Date(`${mois}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });

/** Lecture / écriture de la table de production au format « IDagence ; mot-clé » (une ligne par mot-clé, comme la matrice). */
export function tableEnTexte(t: TableProduction): string {
  return Object.entries(t).sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, ks]) => ks.map((k) => `${id} ; ${k}`)).join("\n");
}
export function texteEnTable(txt: string): TableProduction {
  const t: TableProduction = {};
  for (const l of txt.split(/\r?\n/)) {
    const [id, ...reste] = l.split(/[;\t]/);
    const k = reste.join(" ").trim(), a = (id ?? "").trim().toUpperCase();
    if (!a || !k || !/^[A-Z0-9_-]{1,20}$/.test(a)) continue;
    (t[a] ??= []).includes(k) || t[a].push(k);
  }
  return t;
}
