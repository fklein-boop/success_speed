/**
 * Exports back-office SpeedResa (08_DEMANDES_EQUIPES_EXPORTS § 2 à 4) : catalogue, configuration, connexions, PayBox.
 * Module pur, utilisé dans le navigateur : le type de chaque fichier est reconnu à ses colonnes (pas à son nom),
 * seules les colonnes listées ici sont lues (aucune donnée personnelle), et une correspondance de colonnes
 * mémorisée permet de s'adapter au vrai fichier sans recoder.
 */
import { normalizeHeader, parseAmount, parseDate } from "./dossiers";

export type TypeBackoffice = "catalogue" | "configuration" | "connexions" | "paybox";
type Nature = "texte" | "bool" | "date" | "entier" | "montant" | "liste";
interface Col { label: string; nature: Nature; requis?: boolean; alias?: string[] }

const C = (label: string, nature: Nature, requis = false, alias: string[] = []): Col => ({ label, nature, requis, alias: [normalizeHeader(label), ...alias] });

export const COLONNES: Record<TypeBackoffice, Record<string, Col>> = {
  catalogue: {
    idAgence: C("IDagence", "texte", true, ["agence"]),
    idProduit: C("ID produit", "texte", true, ["produitid", "idproduits"]),
    titre: C("Titre", "texte"),
    type: C("Type", "texte"),
    source: C("Source", "texte"),
    enLigne: C("En ligne", "bool"),
    partageS01: C("Partagé sur S01", "bool"),
    dateMaj: C("Date de dernière mise à jour", "date", false, ["datemiseajour", "datedemaj"]),
    departsFuturs: C("Départs futurs ouverts", "entier"),
    stockGere: C("Stock géré", "bool"),
    prixAdulte: C("Prix adulte", "bool"),
    prixEnfant: C("Prix enfant", "bool"),
    nbSupplements: C("Nb suppléments", "entier"),
    nbOptions: C("Nb options", "entier"),
    assurance: C("Assurance associée", "bool"),
    nbPhotos: C("Nb photos", "entier"),
    veepee: C("Publié sur Veepee", "bool"),
  },
  configuration: {
    idAgence: C("IDagence", "texte", true, ["agence"]),
    migrationScylla: C("Migration Scylla", "bool"),
    dateMigrationScylla: C("Date migration Scylla", "date"),
    scyllaVerifie: C("Scylla vérifié", "bool"),
    dateMajKit: C("Date mise à jour KIT", "date"),
    moyensPaiement: C("Moyens de paiement", "liste"),
    paiementEnLigne: C("Paiement en ligne actif", "bool"),
    troisDs: C("3-D Secure actif", "bool", false, ["3dsecureactif", "3dsecure"]),
    paiementPlusieursFois: C("Paiement en plusieurs fois", "bool"),
    moduleAssurance: C("Module assurance actif", "bool"),
    assureur: C("Assureur", "texte"),
    resaliveActif: C("RésaLive actif", "bool"),
    connecteurs: C("Connecteurs", "liste"),
    dateDernierEchange: C("Date dernier échange connecteur", "date"),
    comptesB2b: C("Comptes B2B / CSE autonomes", "entier", false, ["comptesb2bcseautonomes", "comptesb2b"]),
    optinVeepee: C("Opt-in Veepee", "texte"),
    filtresFluxTo: C("Filtres flux TO actifs", "bool"),
    relancePanier: C("Relance panier active", "bool"),
    derniereConnexionBo: C("Dernière connexion back-office", "date"),
    connexions30j: C("Connexions back-office 30 j", "entier", false, ["connexionsbackoffice30j"]),
    utilisateurs30j: C("Utilisateurs actifs 30 j", "entier"),
    dateFinContrat: C("Date fin de contrat", "date"),
    offre: C("Offre souscrite", "texte"),
  },
  connexions: {
    idAgence: C("IDagence", "texte", true, ["agence"]),
    date: C("Date", "date", true),
    nbConnexions: C("Nb connexions", "entier", true),
    nbUtilisateurs: C("Nb utilisateurs distincts", "entier", false, ["nbutilisateurs"]),
  },
  paybox: {
    idAgence: C("IDagence", "texte", true, ["agence"]),
    date: C("Date", "date", true),
    reference: C("Référence transaction", "texte", true, ["reference", "referencepaybox"]),
    idResa: C("IDresa", "texte", true),
    montant: C("Montant", "montant"),
    statut: C("Statut", "texte"),
    troisDs: C("3-D Secure", "bool", false, ["3dsecure"]),
  },
};

export const LIBELLES_TYPE: Record<TypeBackoffice, string> = {
  catalogue: "Catalogue produits", configuration: "Configuration des comptes", connexions: "Connexions back-office", paybox: "Transactions PayBox",
};

/** Colonnes caractéristiques de chaque type (au moins 2 doivent être présentes) */
const SIGNATURES: Record<TypeBackoffice, string[]> = {
  catalogue: ["idproduit", "enligne", "prixadulte", "departsfutursouverts", "stockgere", "nboptions"],
  configuration: ["migrationscylla", "paiementenligneactif", "moduleassuranceactif", "connecteurs", "optinveepee", "datemiseajourkit"],
  connexions: ["nbconnexions", "nbutilisateursdistincts"],
  paybox: ["referencetransaction", "3dsecure"],
};

export type TypeFichier = TypeBackoffice | "dossiers" | null;

/** Type d'un fichier d'après ses colonnes. */
export function typeDeFichier(headers: unknown[]): TypeFichier {
  const n = new Set(headers.map(normalizeHeader));
  if (n.has("idresa") && (n.has("statutdudossier") || n.has("totaldudossier")) && !n.has("referencetransaction")) return "dossiers";
  let meilleur: TypeBackoffice | null = null, score = 1;
  for (const [t, sig] of Object.entries(SIGNATURES) as [TypeBackoffice, string[]][]) {
    const s = sig.filter((x) => n.has(x)).length;
    if (s > score) { meilleur = t; score = s; }
  }
  return meilleur;
}

/** Repère la ligne d'en-tête d'un export back-office (celle qui contient IDagence). */
export function ligneEntete(matrix: unknown[][], max = 20): number {
  for (let i = 0; i < Math.min(max, matrix.length); i++) if ((matrix[i] ?? []).map(normalizeHeader).includes("idagence")) return i;
  return 0;
}

export type MappingBo = Record<string, number>;

export function colonnesBackoffice(type: TypeBackoffice, headers: unknown[], memorise: Record<string, string> = {}) {
  const norm = headers.map(normalizeHeader);
  const mapping: MappingBo = {};
  for (const [i, n] of norm.entries()) { const ch = memorise[n]; if (ch && COLONNES[type][ch] && mapping[ch] === undefined) mapping[ch] = i; }
  for (const [ch, def] of Object.entries(COLONNES[type])) {
    if (mapping[ch] !== undefined) continue;
    const i = norm.findIndex((n, idx) => def.alias!.includes(n) && !Object.values(mapping).includes(idx));
    if (i >= 0) mapping[ch] = i;
  }
  const manquants = Object.entries(COLONNES[type]).filter(([ch, d]) => d.requis && mapping[ch] === undefined).map(([ch]) => ch);
  const absentes = Object.keys(COLONNES[type]).filter((ch) => mapping[ch] === undefined);
  return { mapping, manquants, absentes };
}

const vide = (v: unknown) => v === null || v === undefined || String(v).trim() === "";
function lire(v: unknown, nature: Nature): unknown {
  if (vide(v)) return null;
  const s = String(v).trim();
  switch (nature) {
    case "bool": return /^(oui|yes|true|1|o|x)$/i.test(s) ? true : /^(non|no|false|0|n)$/i.test(s) ? false : null;
    case "date": return parseDate(v);
    case "entier": { const n = parseAmount(v); return Number.isFinite(n) ? Math.round(n) : null; }
    case "montant": { const n = parseAmount(v); return Number.isFinite(n) ? n : null; }
    case "liste": return s.split("|").map((x) => x.trim()).filter(Boolean);
    default: return s.slice(0, 300);
  }
}

export type LigneBackoffice = Record<string, unknown> & { idAgence: string };

/** Lignes typées (colonnes reconnues uniquement) ; les lignes sans IDagence sont ignorées. */
export function lireLignesBackoffice(type: TypeBackoffice, rows: unknown[][], mapping: MappingBo): { lignes: LigneBackoffice[]; ignorees: number } {
  const lignes: LigneBackoffice[] = [];
  let ignorees = 0;
  for (const r of rows) {
    if (!r || r.every(vide)) continue;
    const o: Record<string, unknown> = {};
    for (const [ch, i] of Object.entries(mapping)) o[ch] = lire(r[i], COLONNES[type][ch].nature);
    const id = typeof o.idAgence === "string" ? o.idAgence.toUpperCase() : null;
    const requisOk = Object.entries(COLONNES[type]).every(([ch, d]) => !d.requis || o[ch] !== null);
    if (!id || !requisOk) { ignorees++; continue; }
    lignes.push({ ...o, idAgence: id });
  }
  return { lignes, ignorees };
}
