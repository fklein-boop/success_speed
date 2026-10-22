import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import { toDay } from "@/lib/metrics/compute";
import { DEFAULT_METRICS_PARAMS, type MetricsParams } from "@/lib/metrics/params";
import { statutFromSeuil, type CritereScore, type Statut } from "./score";

/**
 * Critères de source « Données Speedmedia » calculés sur l'export dossiers et le trafic (GA4 ou fichier GTM).
 * Règle (retours du 22/10/2026) : un critère calculable sur l'export n'est jamais posé à la main.
 * Il reçoit toujours un statut en confiance haute, avec une phrase d'explication, y compris sans volume
 * (NON) ou sans historique suffisant (N.A.). Les critères tirés des exports back-office sont dans backoffice.ts.
 */
export interface PropositionDonnees {
  critereId: string;
  statut: Statut | null;
  valeur: number | null;
  texte: string;
  confiance: "haute" | "moyenne" | "basse";
  source: "donnees";
  preuve: { texte: string; periode: string; source: string; url?: string };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d).replace(".", ",")} %`;
const fr = (iso: string) => iso.split("-").reverse().join("/");
const EN_ATTENTE = new Set(["Devis", "Demande de réservation", "En demande"]);
const jourIso = (j: number) => new Date(j * 86400_000).toISOString().slice(0, 10);

export function propositionsDonnees(
  m: ClientMetrics | null,
  rows: Dossier[],
  reference: string,
  criteres: Map<string, CritereScore>,
  params: MetricsParams = DEFAULT_METRICS_PARAMS,
): PropositionDonnees[] {
  const out: PropositionDonnees[] = [];
  const ref = toDay(reference);
  const src = `Export dossiers SpeedResa, données au ${fr(reference)}`;
  const add = (id: string, valeur: number | null, texte: string, periode: string, statutForce?: Statut | null, opts: { confiance?: PropositionDonnees["confiance"]; source?: string; url?: string } = {}) => {
    const c = criteres.get(id);
    if (!c) return;
    const statut = statutForce !== undefined ? statutForce : c.type === "Seuil" ? statutFromSeuil(valeur, c) : null;
    out.push({ critereId: id, statut, valeur, texte, confiance: opts.confiance ?? (statut ? "haute" : "basse"), source: "donnees", preuve: { texte, periode, source: opts.source ?? src, ...(opts.url ? { url: opts.url } : {}) } });
  };

  const confirmes = new Set(params.statutsConfirmes), annules = new Set(params.statutsAnnules);
  const [y, mo, d] = reference.split("-").map(Number);
  const refN1 = toDay(new Date(Date.UTC(y - 1, mo - 1, d)).toISOString().slice(0, 10));
  // Historique : sans dossier antérieur à la période N-1, la comparaison sur un an n'a pas de sens (nouveau client)
  const premier = rows.reduce<number | null>((min, r) => { const j = toDay(r.date); return min === null || j < min ? j : min; }, null);
  const nouveau = premier === null || premier > refN1 - 90;
  const raisonNA = premier === null ? "Aucun dossier dans l'export SpeedResa : pas d'historique à comparer." : `Historique insuffisant : premier dossier le ${fr(jourIso(premier))}, moins d'un an avant la période comparée.`;

  // PERF-05 : ventes confirmées sur 90 j vs N-1 (en nombre) ; PERF-06 : volume d'affaires (hors annulations)
  let c90 = 0, c90n1 = 0, v90 = 0, v90n1 = 0;
  for (const r of rows) {
    const day = toDay(r.date);
    const dans = day > ref - 90 && day <= ref, dansN1 = day > refN1 - 90 && day <= refN1;
    if (confirmes.has(r.statut)) { if (dans) c90++; if (dansN1) c90n1++; }
    if (!annules.has(r.statut)) { if (dans) v90 += r.total; if (dansN1) v90n1 += r.total; }
  }
  const per = "90 jours glissants vs N-1";
  if (c90n1 > 0) add("PERF-05", c90 / c90n1, `${c90} ventes confirmées sur 90 j contre ${c90n1} un an plus tôt (ratio ${(c90 / c90n1).toFixed(2).replace(".", ",")})`, per);
  else if (c90 === 0 && !nouveau) add("PERF-05", 0, "Aucune vente confirmée sur les 90 derniers jours ni sur la même période l'an dernier.", per, "NON");
  else if (nouveau) add("PERF-05", null, raisonNA, per, "N.A.");
  else add("PERF-05", null, `${c90} ventes confirmées sur 90 j, aucune sur la même période l'an dernier : en progression.`, per, "OUI");

  const eur = (x: number) => `${Math.round(x).toLocaleString("fr-FR")} €`;
  // Même évolution que le portefeuille quand elle est calculée (règles § 2) ; sinon calcul sur les dossiers du client
  if (m && m.evol_90j !== null && m.evol_90j !== undefined) add("PERF-06", m.evol_90j, `Volume 90 j en ${m.evol_90j >= 0 ? "hausse" : "baisse"} de ${pct(Math.abs(m.evol_90j))} sur un an`, per);
  else if (v90n1 > 0) {
    const evol = v90 / v90n1 - 1;
    add("PERF-06", evol, `Volume 90 j de ${eur(v90)} contre ${eur(v90n1)} un an plus tôt (${evol >= 0 ? "+" : "−"}${pct(Math.abs(evol))})`, per);
  } else if (v90 === 0 && !nouveau) add("PERF-06", 0, "Aucune vente sur les 90 derniers jours ni sur la même période l'an dernier.", per, "NON");
  else if (nouveau) add("PERF-06", null, raisonNA, per, "N.A.");
  else add("PERF-06", null, `Volume 90 j de ${eur(v90)}, aucun volume sur la même période l'an dernier : en progression.`, per, "OUI");

  // PERF-12 : transformation des demandes et devis (12 mois)
  const p12 = "12 mois glissants";
  if (m && m.dossiers_12m > 0) add("PERF-12", m.transformation, `${m.confirmes_12m} dossiers confirmés sur ${m.dossiers_12m} créés (${pct(m.transformation)})`, p12);
  else if (premier === null) add("PERF-12", null, raisonNA, p12, "N.A.");
  else add("PERF-12", 0, "Aucune demande ni aucun dossier créé sur les 12 derniers mois.", p12, "NON");

  // RES-04 : RQ ou RésaLive utilisé ; RES-05 : taux d'erreurs RésaLive
  const resalive = m?.resalive_12m ?? 0;
  if (premier === null) add("RES-04", null, raisonNA, p12, "N.A.");
  else add("RES-04", resalive, resalive > 0 ? `${resalive} dossiers d'origine RésaLive sur 12 mois` : "Aucun dossier d'origine RésaLive sur 12 mois.", p12, resalive > 0 ? "OUI" : "NON");
  if (resalive > 0 && m) add("RES-05", m.taux_erreur_resalive, `${pct(m.taux_erreur_resalive)} d'erreurs sur ${resalive} dossiers RésaLive`, p12);
  else add("RES-05", null, "Aucun dossier RésaLive sur 12 mois : taux d'erreurs sans objet.", p12, "N.A.");

  // SOC-07 : dossiers de 30 à 365 j encore en devis / demande
  let anciens = 0, attente = 0;
  for (const r of rows) {
    const day = toDay(r.date);
    if (day > ref - 365 && day <= ref - 30) {
      anciens++;
      if (EN_ATTENTE.has(r.statut)) attente++;
    }
  }
  const p7 = "dossiers de 30 à 365 jours";
  if (anciens) add("SOC-07", attente / anciens, `${attente} dossiers sur ${anciens} créés il y a 30 à 365 j sont encore en devis ou en demande (${pct(attente / anciens)})`, p7);
  else add("SOC-07", null, "Aucun dossier créé il y a 30 à 365 jours : aucun statut à tenir à jour.", p7, "N.A.");

  // PERF-04 : conversion du site (dossiers confirmés ÷ visites), dossiers « site web » seulement si la colonne Origine existe
  const srcTrafic = m?.source_trafic === "GA4" ? "Google Analytics 4 (propriété commune) et export dossiers" : m?.source_trafic === "mixte" ? "Google Analytics 4, fichier GTM et export dossiers" : "Trafic GTM importé et export dossiers";
  const conv = m?.conversion_site ?? m?.conversion ?? null;
  if (m && conv !== null && m.visites_mensuelles) {
    const site = m.conversion_site != null;
    add("PERF-04", conv, `Conversion de ${pct(conv, 2)} : ${site ? "dossiers confirmés venus du site web" : "dossiers confirmés (tous canaux, majorant)"} ÷ ${m.visites_mensuelles.toLocaleString("fr-FR")} visites par mois (${m.periode_trafic}).`, m.periode_trafic ?? "mois mesurés", undefined, { source: srcTrafic });
  } else {
    add("PERF-04", null, "Non vérifiable — trafic du site inconnu. Connectez Google Analytics (Administration → Google Analytics) ou importez le trafic mensuel.", "—", null, { source: "Trafic du site", url: "/admin/google-analytics", confiance: "basse" });
  }

  // TRK-01 : GA4 en place si la propriété commune reçoit des sessions pour ce client
  if (m && (m.source_trafic === "GA4" || m.source_trafic === "mixte") && m.visites_mensuelles) {
    add("TRK-01", m.visites_mensuelles, `La propriété Google Analytics 4 commune reçoit des sessions pour ce client (${m.visites_mensuelles.toLocaleString("fr-FR")} par mois en moyenne, ${m.periode_trafic}).`, m.periode_trafic ?? "mois mesurés", "OUI", { source: "Google Analytics 4 (propriété commune)" });
  }

  return out;
}
