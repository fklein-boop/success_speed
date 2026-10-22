import { DEFAULT_METRICS_PARAMS, type MetricsParams } from "./params";

/** Un dossier de l'export SpeedResa, réduit aux champs utiles au calcul. */
export interface Dossier {
  idAgence: string;
  idResa: string;
  /** Date de réservation au format AAAA-MM-JJ */
  date: string;
  statut: string;
  origine: string;
  total: number;
  erreurResalive: boolean;
  /** Export enrichi (facultatif) */
  canal?: string | null;
  idProduit?: string | null;
  montantOptions?: number | null;
  montantAssurance?: number | null;
  emailRenseigne?: boolean | null;
  payeEnLigne?: number | null;
}

export type Segment = "Champion" | "À activer" | "À risque" | "Fantôme";
export type Risque = "Critique" | "À surveiller" | "Sain";
export type Usage = "Réservation en ligne" | "Demandes / devis" | "Inactif";

export interface Alerte {
  niveau: "critique" | "surveiller";
  code: string;
  message: string;
}

export interface Opportunite {
  code: string;
  libelle: string;
  detail: string;
}

export interface ClientMetrics {
  id: string;
  segment: Segment;
  risque: Risque;
  usage: Usage;
  sante: number;
  s_dynamique: number;
  s_activite: number;
  s_usage: number;
  s_qualite: number;
  volume_12m: number;
  va_confirme_12m: number;
  volume_90j: number;
  volume_90j_n1: number;
  evol_90j: number | null;
  volume_30j: number;
  moyenne_mensuelle_3m: number;
  evol_30j_vs_3m: number | null;
  volume_ytd: number;
  volume_ytd_n1: number;
  dossiers_12m: number;
  dossiers_90j: number;
  confirmes_12m: number;
  annules_12m: number;
  devis_12m: number;
  resalive_12m: number;
  transformation: number;
  taux_erreur_resalive: number;
  taux_annulation: number;
  jours_sans_dossier: number | null;
  dernier_dossier: string | null;
  va_global_estime: number | null;
  part_captee: number | null;
  alertes: Alerte[];
  alerte_principale: string;
  opportunites: Opportunite[];
  /** Trafic et conversion (présents quand le trafic mensuel a été importé) */
  mois_trafic?: number;
  periode_trafic?: string | null;
  visites_mensuelles?: number | null;
  conversion?: number | null;
  conversion_demandes?: number | null;
  panier_moyen_confirme?: number | null;
  conversion_reference?: number | null;
  conversion_reference_source?: "Champions" | "portefeuille" | null;
  manque_a_gagner_mensuel?: number | null;
  /** Google Analytics 4 (quand la propriété consolidée est connectée) */
  source_trafic?: "GA4" | "fichier" | "mixte" | null;
  conversion_web?: number | null;
  abandon_panier?: number | null;
  debuts_reservation_mensuels?: number | null;
  ca_web_mensuel?: number | null;
  abandon_reference?: number | null;
  conversion_site?: number | null;
}

export interface ClientInput {
  id: string;
  vaGlobalEstime?: number | null;
}

const DAY = 86_400_000;
export const toDay = (iso: string) => Math.floor(Date.parse(iso + "T00:00:00Z") / DAY);
export const fromDay = (d: number) => new Date(d * DAY).toISOString().slice(0, 10);

/** Même jour un an plus tôt (29/02 → 28/02). */
function minusOneYear(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y - 1, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

const lin = (x: number, x0: number, x1: number) => Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmtEur = (n: number) => Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ") + " €";
const fmtPct = (x: number) => Math.round(Math.abs(x) * 100) + " %";

/** Date de référence = date du dossier le plus récent de l'export (hors démo). */
export function referenceDate(dossiers: Dossier[], params: MetricsParams = DEFAULT_METRICS_PARAMS): string | null {
  let max: string | null = null;
  for (const d of dossiers) {
    if (params.agencesDemo.includes(d.idAgence)) continue;
    if (!max || d.date > max) max = d.date;
  }
  return max;
}

/**
 * Calcule les indicateurs d'un client. `rows` = tous les dossiers du client.
 * Fenêtres (bornes incluses, en jours) :
 *  - 12 mois : ]réf − 365 ; réf]
 *  - 90 j : ]réf − 90 ; réf], N-1 : même fenêtre décalée d'un an
 *  - 30 j : ]réf − 30 ; réf] vs moyenne mensuelle de ]réf − 120 ; réf − 30]
 */
export function computeClient(
  client: ClientInput,
  rows: Dossier[],
  refIso: string,
  params: MetricsParams = DEFAULT_METRICS_PARAMS,
): ClientMetrics {
  const P = params;
  const ref = toDay(refIso);
  const refN1 = toDay(minusOneYear(refIso));
  const yearStart = toDay(refIso.slice(0, 4) + "-01-01");
  const yearStartN1 = toDay(String(Number(refIso.slice(0, 4)) - 1) + "-01-01");
  const annules = new Set(P.statutsAnnules);
  const confirmes = new Set(P.statutsConfirmes);

  let volume_12m = 0, va_confirme_12m = 0, volume_90j = 0, volume_90j_n1 = 0, volume_30j = 0, volume_3m = 0;
  let volume_ytd = 0, volume_ytd_n1 = 0;
  let dossiers_12m = 0, dossiers_90j = 0, confirmes_12m = 0, annules_12m = 0, devis_12m = 0, resalive_12m = 0, erreurs_12m = 0;
  let last: number | null = null;

  for (const d of rows) {
    const day = toDay(d.date);
    if (day > ref) continue; // dates futures ignorées
    const isAnnule = annules.has(d.statut);
    const gtv = isAnnule ? 0 : d.total;
    if (last === null || day > last) last = day;

    if (day > ref - 365) {
      volume_12m += gtv;
      dossiers_12m++;
      if (confirmes.has(d.statut)) { va_confirme_12m += d.total; confirmes_12m++; }
      if (isAnnule) annules_12m++;
      if (d.statut === "Devis") devis_12m++;
      if (d.origine === "RésaLive") { resalive_12m++; if (d.erreurResalive) erreurs_12m++; }
    }
    if (day > ref - 90) { volume_90j += gtv; dossiers_90j++; }
    if (day > refN1 - 90 && day <= refN1) volume_90j_n1 += gtv;
    if (day > ref - 30) volume_30j += gtv;
    else if (day > ref - 120) volume_3m += gtv;
    if (day >= yearStart) volume_ytd += gtv;
    if (day >= yearStartN1 && day <= refN1) volume_ytd_n1 += gtv;
  }

  const evol_90j = volume_90j_n1 > 0 ? volume_90j / volume_90j_n1 - 1 : null;
  const moyenne_mensuelle_3m = volume_3m / 3;
  const evol_30j_vs_3m = moyenne_mensuelle_3m > 0 ? volume_30j / moyenne_mensuelle_3m - 1 : null;
  const transformation = dossiers_12m > 0 ? confirmes_12m / dossiers_12m : 0;
  const taux_erreur_resalive = resalive_12m > 0 ? erreurs_12m / resalive_12m : 0;
  const taux_annulation = confirmes_12m + annules_12m > 0 ? annules_12m / (confirmes_12m + annules_12m) : 0;
  const jours_sans_dossier = last === null ? null : ref - last;
  const va = client.vaGlobalEstime ?? null;
  const part_captee = va && va > 0 ? volume_12m / va : null;

  const inactif = dossiers_12m === 0;
  const usage: Usage = inactif ? "Inactif" : transformation >= P.seuilReservationEnLigne ? "Réservation en ligne" : "Demandes / devis";

  // ---- Score santé ----
  const S = P.sante;
  let s_dynamique = 0, s_activite = 0, s_usage = 0, s_qualite = 0;
  if (!inactif) {
    // Pas de base N-1 : client nouveau (60 %) s'il a du volume, sinon évolution neutre (0 %).
    s_dynamique += evol_90j === null ? S.dyn90Points * (volume_90j > 0 ? S.partNouveau : lin(0, S.dynBas, S.dynHaut)) : S.dyn90Points * lin(evol_90j, S.dynBas, S.dynHaut);
    s_dynamique += evol_30j_vs_3m === null ? (volume_30j > 0 ? S.dyn30Points * S.partNouveau : 0) : S.dyn30Points * lin(evol_30j_vs_3m, S.dynBas, S.dynHaut);
    s_activite += jours_sans_dossier === null ? 0 : S.recencePoints * (1 - lin(jours_sans_dossier, S.recenceMaxJours, S.recenceZeroJours));
    s_activite += S.dossiers90Points * Math.min(1, dossiers_90j / S.dossiers90Cible);
    s_usage = S.transfoPoints * Math.min(1, transformation / S.transfoCible);
    s_qualite += S.erreurPoints * (1 - lin(taux_erreur_resalive, 0, S.erreurMax));
    s_qualite += S.annulPoints * (1 - lin(taux_annulation, 0, S.annulMax));
  }
  const sante = inactif ? 0 : Math.round(s_dynamique + s_activite + s_usage + s_qualite);
  const segment: Segment = inactif ? "Fantôme" : sante >= P.segments.champion ? "Champion" : sante >= P.segments.aActiver ? "À activer" : "À risque";

  // ---- Alertes ----
  const A = P.alertes;
  const alertes: Alerte[] = [];
  if (inactif) {
    alertes.push({ niveau: "critique", code: "aucun_dossier_12m", message: "Aucun dossier depuis plus de 12 mois" });
  } else {
    if (jours_sans_dossier !== null && jours_sans_dossier >= A.critiqueJoursSansDossier)
      alertes.push({ niveau: "critique", code: "sans_dossier", message: `Aucun dossier depuis ${jours_sans_dossier} jours` });
    if (evol_90j !== null && evol_90j <= A.critiqueBaisse90 && volume_90j_n1 >= A.critiqueBaisse90BaseMin)
      alertes.push({ niveau: "critique", code: "baisse_90j", message: `Volume 90 j en baisse de ${fmtPct(evol_90j)} sur un an` });
    else if (evol_90j !== null && evol_90j <= A.surveillerBaisse90 && volume_90j_n1 >= A.surveillerBaisse90BaseMin)
      alertes.push({ niveau: "surveiller", code: "baisse_90j", message: `Volume 90 j en baisse de ${fmtPct(evol_90j)} sur un an` });
    // Un client sans dossier depuis le seuil critique n'est pas « actif » : la baisse 30 j et le volume faible
    // seraient redondants avec l'alerte « Aucun dossier depuis… ».
    const actif = jours_sans_dossier === null || jours_sans_dossier < A.critiqueJoursSansDossier;
    if (actif && evol_30j_vs_3m !== null && volume_30j < A.surveillerRatio30 * moyenne_mensuelle_3m && moyenne_mensuelle_3m >= A.surveillerRatio30BaseMin)
      alertes.push({ niveau: "surveiller", code: "baisse_30j", message: `30 derniers jours à -${fmtPct(evol_30j_vs_3m)} de la moyenne des 3 mois précédents` });
    if (actif && volume_12m < A.surveillerVolumeMin12m)
      alertes.push({ niveau: "surveiller", code: "volume_faible", message: `Volume quasi nul : ${fmtEur(volume_12m)} sur 12 mois pour ${dossiers_12m} dossiers` });
    if (resalive_12m >= A.surveillerErreurMinDossiers && taux_erreur_resalive >= A.surveillerErreurTaux)
      alertes.push({ niveau: "surveiller", code: "erreurs_resalive", message: `${fmtPct(taux_erreur_resalive)} d'erreurs RésaLive sur 12 mois` });
    if (confirmes_12m + annules_12m >= A.surveillerAnnulMinDossiers && taux_annulation >= A.surveillerAnnulTaux)
      alertes.push({ niveau: "surveiller", code: "annulations", message: `${fmtPct(taux_annulation)} d'annulations` });
  }
  alertes.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === "critique" ? -1 : 1));
  const risque: Risque = alertes.some((a) => a.niveau === "critique") ? "Critique" : alertes.length ? "À surveiller" : "Sain";

  // ---- Opportunités ----
  const O = P.opportunites;
  const opportunites: Opportunite[] = [];
  // Un client Fantôme relève du churn, pas de l'opportunité.
  if (!inactif && va !== null && va >= O.potentielVaMin && (part_captee ?? 0) < O.potentielPartMax)
    opportunites.push({ code: "potentiel", libelle: "Potentiel non capté", detail: `${((part_captee ?? 0) * 100).toFixed(1).replace(".", ",")} % du volume d'affaires estimé (${fmtEur(va)}) passe par SpeedResa` });
  if (dossiers_12m >= O.usageDossiersMin && transformation < O.usageTransfoMax)
    opportunites.push({ code: "usage", libelle: "Usage à faire évoluer", detail: "Proposer la réservation instantanée et le paiement en ligne" });
  // « Conversion » ne se cumule pas avec « Usage à faire évoluer » (même levier, palier suivant).
  else if (devis_12m >= O.conversionDevisMin && transformation < O.conversionTransfoMax)
    opportunites.push({ code: "conversion", libelle: "Conversion", detail: "Proposer la relance des paniers et le paiement fractionné" });
  if (evol_90j !== null && evol_90j >= O.croissanceEvolMin && volume_90j >= O.croissanceVolumeMin)
    opportunites.push({ code: "croissance", libelle: "Croissance", detail: "Moment idéal pour un nouveau projet" });
  if (va !== null && va > 0 && volume_12m > va)
    opportunites.push({ code: "donnee", libelle: "Donnée à vérifier", detail: "Volume réel supérieur à l'estimation globale : mettre l'estimation à jour" });

  return {
    id: client.id,
    segment, risque, usage, sante,
    s_dynamique: r1(s_dynamique), s_activite: r1(s_activite), s_usage: r1(s_usage), s_qualite: r1(s_qualite),
    volume_12m, va_confirme_12m, volume_90j, volume_90j_n1, evol_90j,
    volume_30j, moyenne_mensuelle_3m, evol_30j_vs_3m,
    volume_ytd, volume_ytd_n1,
    dossiers_12m, dossiers_90j, confirmes_12m, annules_12m, devis_12m, resalive_12m,
    transformation, taux_erreur_resalive, taux_annulation,
    jours_sans_dossier, dernier_dossier: last === null ? null : fromDay(last),
    va_global_estime: va, part_captee,
    alertes, alerte_principale: alertes[0]?.message ?? "", opportunites,
  };
}

/** Calcule tous les clients à partir de l'ensemble des dossiers. */
export function computePortfolio(
  clients: ClientInput[],
  dossiers: Dossier[],
  params: MetricsParams = DEFAULT_METRICS_PARAMS,
  refIso?: string,
): { reference: string | null; metrics: ClientMetrics[] } {
  const reference = refIso ?? referenceDate(dossiers, params);
  const byAgence = new Map<string, Dossier[]>();
  for (const d of dossiers) {
    if (params.agencesDemo.includes(d.idAgence)) continue;
    let arr = byAgence.get(d.idAgence);
    if (!arr) byAgence.set(d.idAgence, (arr = []));
    arr.push(d);
  }
  if (!reference) return { reference, metrics: [] };
  return { reference, metrics: clients.map((c) => computeClient(c, byAgence.get(c.id) ?? [], reference, params)) };
}

/** Série mensuelle (volume / confirmé) pour un client, sur 24 mois glissants. */
export function monthlySeries(rows: Dossier[], params: MetricsParams = DEFAULT_METRICS_PARAMS) {
  const annules = new Set(params.statutsAnnules);
  const confirmes = new Set(params.statutsConfirmes);
  const m = new Map<string, { mois: string; volume: number; confirme: number; dossiers: number }>();
  for (const d of rows) {
    const k = d.date.slice(0, 7);
    let e = m.get(k);
    if (!e) m.set(k, (e = { mois: k, volume: 0, confirme: 0, dossiers: 0 }));
    e.dossiers++;
    if (!annules.has(d.statut)) e.volume += d.total;
    if (confirmes.has(d.statut)) e.confirme += d.total;
  }
  return [...m.values()].sort((a, b) => a.mois.localeCompare(b.mois));
}
