import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import { toDay } from "@/lib/metrics/compute";
import { DEFAULT_METRICS_PARAMS, type MetricsParams } from "@/lib/metrics/params";
import { statutFromSeuil, type CritereScore, type Statut } from "./score";
import type { PropositionDonnees } from "./donnees";

/**
 * Critères tirés des exports back-office (08_DEMANDES_EQUIPES_EXPORTS) : catalogue, configuration des comptes,
 * connexions, PayBox et colonnes enrichies de l'export dossiers. Module pur (testé sans base).
 * Tant qu'un export n'a jamais été importé, ses critères restent manuels avec la mention « en attente de l'export … ».
 */
export interface ProduitCatalogue {
  idProduit: string;
  source: string | null;
  enLigne: boolean | null;
  partageS01: boolean | null;
  dateMaj: string | null;
  departsFuturs: number | null;
  stockGere: boolean | null;
  prixAdulte: boolean | null;
  prixEnfant: boolean | null;
  nbOptions: number | null;
  assurance: boolean | null;
}

/** Valeurs typées d'une ligne de l'export configuration (null = colonne absente ou vide) */
export interface ConfigCompte {
  migrationScylla?: boolean | null;
  scyllaVerifie?: boolean | null;
  dateMajKit?: string | null;
  paiementEnLigne?: boolean | null;
  troisDs?: boolean | null;
  moduleAssurance?: boolean | null;
  connecteurs?: string[] | null;
  dateDernierEchange?: string | null;
  comptesB2b?: number | null;
  optinVeepee?: string | null;
  filtresFluxTo?: boolean | null;
  relancePanier?: boolean | null;
  derniereConnexionBo?: string | null;
  connexions30j?: number | null;
  dateFinContrat?: string | null;
  [k: string]: unknown;
}

export type TypeExport = "catalogue" | "configuration" | "connexions" | "paybox" | "dossiers enrichi";

export interface EntreeBackoffice {
  /** Date du jour de calcul (AAAA-MM-JJ) */
  aujourdhui: string;
  modele: string | null;
  /** null = export catalogue jamais importé ; [] = importé, aucun produit pour ce client */
  catalogue: ProduitCatalogue[] | null;
  /** undefined = export configuration jamais importé ; null = importé, client absent */
  config: ConfigCompte | null | undefined;
  /** null = export connexions jamais importé */
  connexions: { date: string; nb: number }[] | null;
  /** null = export PayBox jamais importé */
  paybox: { idResa: string | null; statut: string | null; date: string }[] | null;
  dossiers: Dossier[];
  m: ClientMetrics | null;
  /** Source de l'abandon panier (PERF-07) : colonne « Email renseigné » ou événements GA4 */
  sourceAbandon: "dossiers" | "ga4";
  params?: MetricsParams;
}

export interface Attente { critereId: string; texte: string }

/** Critères en attente de chaque export */
export const CRITERES_PAR_EXPORT: Record<Exclude<TypeExport, "dossiers enrichi" | "connexions">, string[]> = {
  catalogue: ["PROD-02", "PROD-05", "PROD-06", "PROD-07", "PROD-08", "PERF-03", "RES-02", "RES-03"],
  configuration: ["PROD-07", "RES-01", "SOC-01", "SOC-02", "SOC-03", "SOC-06", "SOC-08", "LEG-12", "DIST-01", "PERF-13", "PERF-02"],
  paybox: ["SOC-04"],
};

/** Seuils des critères Oui/Non devenus mesurables (proposés dans 09_PROMPT_RETOURS_TEST, ou par nous pour RES-02/03) */
export const SEUILS_BO = {
  "PROD-02": { plein: 0.9, moitie: 0.6 },
  "PROD-05": { plein: 0.5, moitie: 0.2 },
  "RES-02": { plein: 0.3, moitie: 0.1 },
  "RES-03": { plein: 0.1, moitie: 0.03 },
  "SOC-04": { plein: 0.98, moitie: 0.9 },
} as const;

const pct = (x: number) => `${Math.round(x * 100)} %`;
const fr = (iso: string) => iso.split("-").reverse().join("/");
const interne = (p: ProduitCatalogue) => !p.source || /interne/i.test(p.source);
const ratio = (n: number, d: number) => (d ? n / d : 0);

export function propositionsBackoffice(e: EntreeBackoffice, criteres: Map<string, CritereScore>): { propositions: PropositionDonnees[]; attentes: Attente[] } {
  const propositions: PropositionDonnees[] = [];
  const attentes: Attente[] = [];
  const params = e.params ?? DEFAULT_METRICS_PARAMS;
  const auj = toDay(e.aujourdhui);
  const add = (id: string, statut: Statut | null, valeur: number | null, texte: string, source: string, confiance: PropositionDonnees["confiance"] = "haute") => {
    if (!criteres.has(id) || propositions.some((p) => p.critereId === id)) return;
    propositions.push({ critereId: id, statut, valeur, texte, confiance: statut ? confiance : "basse", source: "donnees", preuve: { texte, periode: `données au ${fr(e.aujourdhui)}`, source } });
  };
  const seuil = (id: keyof typeof SEUILS_BO, v: number): Statut => (v >= SEUILS_BO[id].plein ? "OUI" : v >= SEUILS_BO[id].moitie ? "PARTIELLEMENT" : "NON");
  const parSeuilCritere = (id: string, v: number) => { const c = criteres.get(id); return c ? statutFromSeuil(v, c) : null; };
  const attendre = (ids: string[], exp: string) => { for (const id of ids) if (criteres.has(id) && !attentes.some((a) => a.critereId === id)) attentes.push({ critereId: id, texte: `En attente de l'export ${exp} du back-office SpeedResa : critère à renseigner à la main d'ici là.` }); };

  // ───── Catalogue ─────
  const SC = "Export catalogue produits SpeedResa";
  if (e.catalogue === null) attendre(CRITERES_PAR_EXPORT.catalogue.filter((x) => x !== "PROD-07"), "catalogue");
  else {
    const enLigne = e.catalogue.filter((p) => p.enLigne !== false);
    const internes = enLigne.filter(interne);
    if (!enLigne.length) {
      for (const id of ["PROD-02", "PROD-05", "PROD-06", "PROD-08", "PERF-03", "RES-02", "RES-03"]) add(id, "N.A.", null, "Aucun produit en ligne dans le catalogue de ce client.", SC);
    } else {
      if (internes.length) {
        const complets = internes.filter((p) => p.prixAdulte === true && p.prixEnfant === true).length;
        const r = ratio(complets, internes.length);
        add("PROD-02", seuil("PROD-02", r), r, `${complets} produits internes en ligne sur ${internes.length} ont un prix adulte et un prix enfant (${pct(r)}).`, SC);
        const dispo = internes.filter((p) => (p.departsFuturs ?? 0) >= 1).length;
        const rd = ratio(dispo, internes.length);
        add("PERF-03", parSeuilCritere("PERF-03", rd), rd, `${dispo} produits internes en ligne sur ${internes.length} ont au moins un départ futur ouvert (${pct(rd)}).`, SC);
        const partages = internes.filter((p) => p.partageS01 === true).length;
        const rp = ratio(partages, internes.length);
        add("RES-02", seuil("RES-02", rp), rp, `${partages} produits internes sur ${internes.length} sont partagés sur le réseau S01 (${pct(rp)}).`, SC);
      } else {
        for (const id of ["PROD-02", "PERF-03", "RES-02"]) add(id, "N.A.", null, "Aucune production interne en ligne : critère sans objet.", SC);
      }
      const stock = enLigne.filter((p) => p.stockGere === true).length, rs = ratio(stock, enLigne.length);
      add("PROD-05", seuil("PROD-05", rs), rs, `${stock} produits en ligne sur ${enLigne.length} ont un stock géré (${pct(rs)}).`, SC);
      const opt = enLigne.filter((p) => (p.nbOptions ?? 0) >= 1).length, ro = ratio(opt, enLigne.length);
      add("PROD-06", parSeuilCritere("PROD-06", ro), ro, `${opt} produits en ligne sur ${enLigne.length} proposent au moins une option (${pct(ro)}).`, SC);
      const frais = enLigne.filter((p) => p.dateMaj && toDay(p.dateMaj) >= auj - 90).length, rf = ratio(frais, enLigne.length);
      add("PROD-08", parSeuilCritere("PROD-08", rf), rf, `${frais} produits en ligne sur ${enLigne.length} ont été mis à jour depuis moins de 90 jours (${pct(rf)}).`, SC);
      const reseau = enLigne.filter((p) => /s01|r[ée]seau/i.test(p.source ?? "")).length, rr = ratio(reseau, enLigne.length);
      add("RES-03", seuil("RES-03", rr), rr, `${reseau} produits en ligne sur ${enLigne.length} proviennent du réseau S01 (${pct(rr)}).`, SC);
    }
  }

  // ───── Configuration (et connexions) ─────
  const SF = "Export configuration des comptes SpeedResa";
  const c = e.config;
  if (c === undefined) attendre(CRITERES_PAR_EXPORT.configuration.filter((x) => x !== "SOC-08" || e.connexions === null), "configuration");
  else if (c === null) {
    for (const id of CRITERES_PAR_EXPORT.configuration) if (id !== "SOC-08" || e.connexions === null) attentes.push({ critereId: id, texte: "Client absent de l'export configuration : critère à renseigner à la main." });
  } else {
    const oui = (v: boolean | null | undefined, id: string, okTxt: string, koTxt: string) => { if (v === true) add(id, "OUI", 1, okTxt, SF); else if (v === false) add(id, "NON", 0, koTxt, SF); };
    oui(c.paiementEnLigne, "SOC-03", "Paiement en ligne actif.", "Aucun paiement en ligne actif.");
    oui(c.troisDs, "LEG-12", "Authentification forte 3-D Secure active sur le paiement.", "3-D Secure n'est pas actif sur le paiement en ligne.");
    oui(c.relancePanier, "PERF-13", "Relance automatique des paniers activée.", "Relance automatique des paniers non activée.");
    if (c.filtresFluxTo === true) add("PERF-02", "OUI", 1, "Filtres des flux TO paramétrés dans le back-office : lisibilité de l'offre à confirmer par le CSM.", SF, "moyenne");
    else if (c.filtresFluxTo === false) add("PERF-02", "NON", 0, "Aucun filtre des flux TO paramétré : vérifier si l'offre publiée est lisible.", SF, "moyenne");
    if (c.migrationScylla === true && c.scyllaVerifie === true) add("SOC-06", "OUI", 1, "Migration Scylla effectuée et fonctionnement vérifié.", SF);
    else if (c.migrationScylla === true) add("SOC-06", "PARTIELLEMENT", 0.5, "Migration Scylla effectuée, fonctionnement pas encore vérifié.", SF);
    else if (c.migrationScylla === false) add("SOC-06", "NON", 0, "Migration Scylla non effectuée.", SF);
    if (c.dateMajKit) add("SOC-02", toDay(c.dateMajKit) >= auj - 365 ? "OUI" : "NON", null, `KIT mis à jour le ${fr(c.dateMajKit)}${toDay(c.dateMajKit) >= auj - 365 ? "" : " : plus de 12 mois"}.`, SF);
    else add("SOC-02", "NON", null, "Aucune date de mise à jour du KIT renseignée.", SF);
    const v = (c.optinVeepee ?? "").toLowerCase();
    if (v === "oui") add("DIST-01", "OUI", 1, "Opt-in Veepee actif.", SF);
    else if (v.startsWith("eligible") || v.startsWith("éligible")) add("DIST-01", "NON", 0, "Éligible à Veepee, opt-in non activé : à proposer.", SF);
    else if (v === "non") add("DIST-01", "NON", 0, "Pas d'opt-in Veepee.", SF);
    if (/b2b|cse/i.test(e.modele ?? "")) {
      const n = c.comptesB2b ?? 0;
      add("RES-01", n >= 1 ? "OUI" : "NON", n, n >= 1 ? `${n} compte(s) client autonome(s) créé(s).` : "Aucun compte client autonome créé.", SF);
    } else add("RES-01", "N.A.", null, `Modèle ${e.modele ?? "non renseigné"} : comptes B2B / CSE sans objet.`, SF);
    const metier = (c.connecteurs ?? []).filter((x) => /^(crm|erp)\b/i.test(x.trim()));
    if (!metier.length) add("SOC-01", "NON", 0, "Aucun CRM ni ERP connecté.", SF);
    else if (c.dateDernierEchange && toDay(c.dateDernierEchange) >= auj - 7) add("SOC-01", "OUI", metier.length, `${metier.join(", ")} connecté(s), dernier échange le ${fr(c.dateDernierEchange)}.`, SF);
    else add("SOC-01", "PARTIELLEMENT", metier.length, `${metier.join(", ")} connecté(s), mais ${c.dateDernierEchange ? `dernier échange le ${fr(c.dateDernierEchange)} (plus de 7 jours)` : "aucun échange récent connu"}.`, SF);
  }
  // PROD-07 : configuration + catalogue
  if (c && e.catalogue) {
    const enLigne = e.catalogue.filter((p) => p.enLigne !== false);
    const r = ratio(enLigne.filter((p) => p.assurance === true).length, enLigne.length);
    if (c.moduleAssurance === true) add("PROD-07", r >= 0.5 ? "OUI" : "PARTIELLEMENT", r, `Module assurance actif ; ${pct(r)} des produits en ligne ont une assurance associée.`, `${SF} et catalogue`);
    else if (c.moduleAssurance === false) add("PROD-07", "NON", 0, "Module assurance non activé.", SF);
  } else if (c !== undefined || e.catalogue !== null) attendre(["PROD-07"], e.catalogue === null ? "catalogue" : "configuration");

  // SOC-08 : usage du back-office (export connexions, sinon colonnes de la configuration)
  if (e.connexions !== null) {
    const semaines = new Set(e.connexions.filter((x) => x.nb > 0 && toDay(x.date) > auj - 28 && toDay(x.date) <= auj).map((x) => Math.floor((auj - toDay(x.date)) / 7)));
    const n30 = e.connexions.filter((x) => toDay(x.date) > auj - 30).reduce((s, x) => s + x.nb, 0);
    const st: Statut = semaines.size >= 4 || n30 >= 4 ? "OUI" : semaines.size >= 2 || n30 >= 1 ? "PARTIELLEMENT" : "NON";
    add("SOC-08", st, semaines.size, `Connexions au back-office sur 4 semaines : ${semaines.size} semaine(s) sur 4 avec au moins une connexion, ${n30} connexion(s) sur 30 jours.`, "Export connexions back-office");
  } else if (c && (c.connexions30j !== null && c.connexions30j !== undefined)) {
    const n = c.connexions30j;
    add("SOC-08", n >= 4 ? "OUI" : n >= 1 ? "PARTIELLEMENT" : "NON", n, `${n} connexion(s) au back-office sur 30 jours${c.derniereConnexionBo ? `, dernière le ${fr(c.derniereConnexionBo)}` : ""}.`, SF);
  }

  // ───── Export dossiers enrichi ─────
  const confirmes = new Set(params.statutsConfirmes);
  const d12 = e.dossiers.filter((d) => toDay(d.date) > auj - 365);
  const avecMontants = e.dossiers.some((d) => d.montantOptions != null || d.montantAssurance != null);
  if (avecMontants) {
    const conf = d12.filter((d) => confirmes.has(d.statut));
    const total = conf.reduce((s, d) => s + d.total, 0);
    const extra = conf.reduce((s, d) => s + (d.montantOptions ?? 0) + (d.montantAssurance ?? 0), 0);
    if (total > 0) { const r = extra / total; add("PERF-08", parSeuilCritere("PERF-08", r), r, `Options et assurances : ${Math.round(extra).toLocaleString("fr-FR")} € sur ${Math.round(total).toLocaleString("fr-FR")} € de dossiers confirmés en 12 mois (${pct(r)}).`, "Export dossiers enrichi"); }
    else add("PERF-08", "N.A.", null, "Aucun dossier confirmé sur 12 mois.", "Export dossiers enrichi");
  } else attendre(["PERF-08"], "dossiers enrichi (colonnes Montant options et Montant assurance)");

  // PERF-07 : abandon panier, source paramétrable
  if (e.sourceAbandon === "ga4") {
    if (e.m?.abandon_panier != null) add("PERF-07", parSeuilCritere("PERF-07", e.m.abandon_panier), e.m.abandon_panier, `${pct(e.m.abandon_panier)} des réservations commencées sur le site ne sont pas finalisées (Google Analytics 4).`, "Google Analytics 4 (begin_checkout / purchase)");
    else attentes.push({ critereId: "PERF-07", texte: "Abandon panier non mesuré : Google Analytics 4 ne remonte pas assez de débuts de réservation pour ce client." });
  } else {
    const paniers = d12.filter((d) => d.emailRenseigne === true);
    if (e.dossiers.some((d) => d.emailRenseigne != null)) {
      if (paniers.length >= 20) { const r = paniers.filter((d) => !confirmes.has(d.statut)).length / paniers.length; add("PERF-07", parSeuilCritere("PERF-07", r), r, `${pct(r)} des ${paniers.length} paniers avec email (12 mois) n'ont pas abouti.`, "Export dossiers enrichi (Email renseigné)"); }
      else add("PERF-07", "N.A.", null, `Seulement ${paniers.length} panier(s) avec email sur 12 mois : taux non significatif.`, "Export dossiers enrichi (Email renseigné)");
    } else attendre(["PERF-07"], "dossiers enrichi (colonne Email renseigné)");
  }

  // SOC-04 : rapprochement PayBox / dossiers payés en ligne
  if (e.paybox === null) attendre(CRITERES_PAR_EXPORT.paybox, "PayBox");
  else if (!e.dossiers.some((d) => d.payeEnLigne != null)) attendre(["SOC-04"], "dossiers enrichi (colonne Payé en ligne)");
  else {
    const dates = e.paybox.map((t) => toDay(t.date));
    const debut = dates.length ? Math.min(...dates) : auj - 31, fin = dates.length ? Math.max(...dates) : auj;
    const payes = e.dossiers.filter((d) => (d.payeEnLigne ?? 0) > 0 && toDay(d.date) >= debut && toDay(d.date) <= fin);
    const trouvees = new Set(e.paybox.filter((t) => t.idResa && !/refus/i.test(t.statut ?? "")).map((t) => t.idResa!));
    if (!payes.length) add("SOC-04", "N.A.", null, "Aucun dossier payé en ligne sur la période de l'export PayBox.", "Rapprochement PayBox / export dossiers");
    else {
      const ecarts = payes.filter((d) => !trouvees.has(d.idResa)).map((d) => d.idResa);
      const r = 1 - ecarts.length / payes.length;
      add("SOC-04", seuil("SOC-04", r), r, `${payes.length - ecarts.length} dossiers payés en ligne sur ${payes.length} ont leur transaction PayBox (${pct(r)}).${ecarts.length ? ` Écarts : ${ecarts.slice(0, 15).join(", ")}${ecarts.length > 15 ? `… (+${ecarts.length - 15})` : ""}.` : ""}`, "Rapprochement PayBox / export dossiers");
    }
  }

  return { propositions, attentes: attentes.filter((a) => !propositions.some((p) => p.critereId === a.critereId)) };
}
