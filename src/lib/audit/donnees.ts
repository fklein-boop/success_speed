import type { ClientMetrics, Dossier } from "@/lib/metrics/compute";
import { toDay } from "@/lib/metrics/compute";
import { DEFAULT_METRICS_PARAMS, type MetricsParams } from "@/lib/metrics/params";
import { statutFromSeuil, type CritereScore, type Statut } from "./score";

/**
 * Critères de source « Données Speedmedia » calculables à partir de l'export dossiers.
 * Les autres (catalogue, PayBox, back-office…) nécessitent des données que l'export ne contient pas.
 */
export interface PropositionDonnees {
  critereId: string;
  statut: Statut | null;
  valeur: number | null;
  texte: string;
  confiance: "haute" | "moyenne" | "basse";
  source: "donnees";
  preuve: { texte: string; periode: string; source: string };
}

const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
const fr = (iso: string) => iso.split("-").reverse().join("/");
const EN_ATTENTE = new Set(["Devis", "Demande de réservation", "En demande"]);

export function propositionsDonnees(
  m: ClientMetrics,
  rows: Dossier[],
  reference: string,
  criteres: Map<string, CritereScore>,
  params: MetricsParams = DEFAULT_METRICS_PARAMS,
): PropositionDonnees[] {
  const out: PropositionDonnees[] = [];
  const ref = toDay(reference);
  const src = `Export dossiers SpeedResa, données au ${fr(reference)}`;
  const add = (id: string, valeur: number | null, texte: string, periode: string, statutForce?: Statut | null) => {
    const c = criteres.get(id);
    if (!c) return;
    const statut = statutForce !== undefined ? statutForce : c.type === "Seuil" ? statutFromSeuil(valeur, c) : null;
    out.push({ critereId: id, statut, valeur, texte, confiance: statut ? "haute" : "basse", source: "donnees", preuve: { texte, periode, source: src } });
  };

  if (m.dossiers_12m === 0) return out;

  // PERF-05 : ventes confirmées sur 90 j vs N-1 (en nombre)
  const confirmes = new Set(params.statutsConfirmes);
  const [y, mo, d] = reference.split("-").map(Number);
  const refN1 = toDay(new Date(Date.UTC(y - 1, mo - 1, d)).toISOString().slice(0, 10));
  let c90 = 0, c90n1 = 0;
  for (const r of rows) {
    if (!confirmes.has(r.statut)) continue;
    const day = toDay(r.date);
    if (day > ref - 90 && day <= ref) c90++;
    if (day > refN1 - 90 && day <= refN1) c90n1++;
  }
  if (c90n1 > 0) add("PERF-05", c90 / c90n1, `${c90} ventes confirmées sur 90 j contre ${c90n1} un an plus tôt (ratio ${(c90 / c90n1).toFixed(2).replace(".", ",")})`, "90 jours glissants vs N-1");
  else add("PERF-05", null, `${c90} ventes confirmées sur 90 j, aucune sur la même période N-1 : comparaison impossible`, "90 jours glissants vs N-1", null);

  // PERF-06 : évolution du volume d'affaires 90 j vs N-1
  if (m.evol_90j !== null) add("PERF-06", m.evol_90j, `Volume 90 j en ${m.evol_90j >= 0 ? "hausse" : "baisse"} de ${pct(Math.abs(m.evol_90j))} sur un an`, "90 jours glissants vs N-1");
  else add("PERF-06", null, "Pas de volume sur la même période N-1 : évolution non calculable", "90 jours glissants vs N-1", null);

  // PERF-12 : transformation des demandes et devis
  add("PERF-12", m.transformation, `${m.confirmes_12m} dossiers confirmés sur ${m.dossiers_12m} créés (${pct(m.transformation)})`, "12 mois glissants");

  // RES-04 : RQ ou RésaLive utilisé
  add("RES-04", m.resalive_12m, `${m.resalive_12m} dossiers d'origine RésaLive sur 12 mois`, "12 mois glissants", m.resalive_12m > 0 ? "OUI" : "NON");

  // RES-05 : taux d'erreurs RésaLive (non pertinent sans dossier RésaLive)
  if (m.resalive_12m > 0) add("RES-05", m.taux_erreur_resalive, `${pct(m.taux_erreur_resalive)} d'erreurs sur ${m.resalive_12m} dossiers RésaLive`, "12 mois glissants");
  else add("RES-05", null, "Aucun dossier RésaLive sur 12 mois", "12 mois glissants", "N.A.");

  // SOC-07 : dossiers de 30 à 365 j encore en devis / demande
  let anciens = 0, attente = 0;
  for (const r of rows) {
    const day = toDay(r.date);
    if (day > ref - 365 && day <= ref - 30) {
      anciens++;
      if (EN_ATTENTE.has(r.statut)) attente++;
    }
  }
  if (anciens) add("SOC-07", attente / anciens, `${attente} dossiers sur ${anciens} créés il y a 30 à 365 j sont encore en devis ou en demande (${pct(attente / anciens)})`, "dossiers de 30 à 365 jours");

  return out;
}
