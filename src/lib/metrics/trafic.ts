import type { ClientMetrics, Dossier } from "./compute";
import type { MetricsParams } from "./params";

/**
 * Trafic et conversion (§ 7) : à partir des visites mensuelles importées (GTM) et des dossiers SpeedResa.
 * - conversion = dossiers confirmés ÷ visites, sur les mois où le trafic est mesuré (12 derniers mois au plus) ;
 * - conversion des demandes = dossiers créés (hors annulations) ÷ visites ;
 * - manque à gagner mensuel (estimation) = (conversion de référence − conversion du client) × visites mensuelles × panier moyen confirmé.
 * La référence est la médiane des Champions (au moins 3 avec du trafic), à défaut celle du portefeuille (au moins 5).
 * Limite : les dossiers saisis en agence sont comptés avec ceux du site, la conversion est donc un majorant.
 * Avec Google Analytics 4 (événements du site, par « Nom du client ») s'ajoutent :
 * - conversion web = achats (purchase) ÷ sessions ;
 * - abandon panier = 1 − achats ÷ débuts de réservation (begin_checkout), comparé à la médiane du portefeuille.
 */
export interface Trafic {
  mois_trafic: number;
  periode_trafic: string | null;
  visites_mensuelles: number | null;
  conversion: number | null;
  conversion_demandes: number | null;
  panier_moyen_confirme: number | null;
  conversion_reference: number | null;
  conversion_reference_source: "Champions" | "portefeuille" | null;
  manque_a_gagner_mensuel: number | null;
  /** Origine des visites : GA4, fichier GTM, ou les deux selon les mois */
  source_trafic: "GA4" | "fichier" | "mixte" | null;
  conversion_web: number | null;
  abandon_panier: number | null;
  debuts_reservation_mensuels: number | null;
  ca_web_mensuel: number | null;
  abandon_reference: number | null;
  /** Conversion des seuls dossiers d'origine « site web » (export enrichi, colonne « Origine ») */
  conversion_site: number | null;
}

/** Données GA4 d'un mois (null = non mesuré) */
export interface MoisWeb { debuts: number | null; achats: number | null; ca: number | null }

/** Nombre minimal de débuts de réservation sur la période pour calculer un taux d'abandon */
export const DEBUTS_MIN_ABANDON = 30;

export const TRAFIC_VIDE: Trafic = {
  mois_trafic: 0, periode_trafic: null, visites_mensuelles: null, conversion: null, conversion_demandes: null,
  panier_moyen_confirme: null, conversion_reference: null, conversion_reference_source: null, manque_a_gagner_mensuel: null,
  source_trafic: null, conversion_web: null, abandon_panier: null, debuts_reservation_mensuels: null, ca_web_mensuel: null, abandon_reference: null, conversion_site: null,
};

/** Trafic d'un client : `visites` = mois AAAA-MM → visites ; `web` = mois mesurés par GA4 ; `reference` = date des données. */
export function traficClient(m: ClientMetrics, rows: Dossier[], visites: Map<string, number>, reference: string, params: MetricsParams, web: Map<string, MoisWeb> = new Map()): Trafic {
  const moisRef = reference.slice(0, 7);
  const [y, mo] = moisRef.split("-").map(Number);
  const debut = new Date(Date.UTC(y - 1, mo - 1, 1)).toISOString().slice(0, 7);
  // Mois complets mesurés, dans les 12 derniers mois
  const mois = [...visites.keys()].filter((k) => k >= debut && k < moisRef && (visites.get(k) ?? 0) > 0).sort();
  if (!mois.length) return { ...TRAFIC_VIDE };
  const set = new Set(mois);
  const confirmes = new Set(params.statutsConfirmes), annules = new Set(params.statutsAnnules);
  let nConf = 0, nDem = 0, nConfSite = 0, avecCanal = false;
  for (const d of rows) {
    if (!set.has(d.date.slice(0, 7))) continue;
    if (d.canal) avecCanal = true;
    if (confirmes.has(d.statut)) { nConf++; if (d.canal === "site web") nConfSite++; }
    if (!annules.has(d.statut)) nDem++;
  }
  const totalVisites = mois.reduce((s, k) => s + (visites.get(k) ?? 0), 0);
  const fr = (k: string) => `${k.slice(5)}/${k.slice(0, 4)}`;
  // Mesures GA4 (mois où les événements du site sont remontés)
  const moisWeb = mois.filter((k) => web.get(k)?.achats != null);
  const sessionsWeb = moisWeb.reduce((s, k) => s + (visites.get(k) ?? 0), 0);
  const achats = moisWeb.reduce((s, k) => s + (web.get(k)!.achats ?? 0), 0);
  const moisDebuts = moisWeb.filter((k) => web.get(k)!.debuts != null);
  const debuts = moisDebuts.reduce((s, k) => s + (web.get(k)!.debuts ?? 0), 0);
  const achatsDebuts = moisDebuts.reduce((s, k) => s + (web.get(k)!.achats ?? 0), 0);
  const ca = moisWeb.reduce((s, k) => s + (web.get(k)!.ca ?? 0), 0);
  return {
    ...TRAFIC_VIDE,
    mois_trafic: mois.length,
    periode_trafic: mois.length === 1 ? fr(mois[0]) : `${fr(mois[0])} à ${fr(mois[mois.length - 1])}`,
    visites_mensuelles: Math.round(totalVisites / mois.length),
    conversion: nConf / totalVisites,
    conversion_demandes: nDem / totalVisites,
    panier_moyen_confirme: m.confirmes_12m > 0 ? m.va_confirme_12m / m.confirmes_12m : null,
    source_trafic: !moisWeb.length ? "fichier" : moisWeb.length === mois.length ? "GA4" : "mixte",
    conversion_web: moisWeb.length && sessionsWeb > 0 ? achats / sessionsWeb : null,
    abandon_panier: debuts >= DEBUTS_MIN_ABANDON ? Math.max(0, 1 - achatsDebuts / debuts) : null,
    debuts_reservation_mensuels: moisDebuts.length ? Math.round(debuts / moisDebuts.length) : null,
    ca_web_mensuel: moisWeb.length && ca > 0 ? ca / moisWeb.length : null,
    conversion_site: avecCanal ? nConfSite / totalVisites : null,
  };
}

const mediane = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

/** Conversion de référence (Champions, à défaut portefeuille) et manque à gagner de chaque client. */
export function manqueAGagner(lignes: { segment: string; trafic: Trafic }[]): void {
  const avec = lignes.filter((l) => l.trafic.conversion !== null && (l.trafic.visites_mensuelles ?? 0) >= 100);
  const champions = avec.filter((l) => l.segment === "Champion").map((l) => l.trafic.conversion!);
  const ref = champions.length >= 3 ? { v: mediane(champions), src: "Champions" as const } : avec.length >= 5 ? { v: mediane(avec.map((l) => l.trafic.conversion!)), src: "portefeuille" as const } : null;
  for (const l of lignes) {
    const t = l.trafic;
    if (!ref || t.conversion === null) continue;
    t.conversion_reference = ref.v;
    t.conversion_reference_source = ref.src;
    t.manque_a_gagner_mensuel = t.panier_moyen_confirme !== null && t.visites_mensuelles !== null
      ? Math.max(0, ref.v - t.conversion) * t.visites_mensuelles * t.panier_moyen_confirme : null;
  }
  // Abandon panier : médiane du portefeuille (au moins 5 clients mesurés par GA4)
  const abandons = lignes.map((l) => l.trafic.abandon_panier).filter((x): x is number => x !== null);
  if (abandons.length >= 5) { const a = mediane(abandons); for (const l of lignes) if (l.trafic.abandon_panier !== null) l.trafic.abandon_reference = a; }
}
