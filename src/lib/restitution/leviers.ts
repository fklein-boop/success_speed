import type { ClientMetrics } from "@/lib/metrics/compute";

/**
 * Leviers de performance (§ 7 des règles de calcul) : chaque indicateur en retard
 * renvoie aux critères d'audit à examiner en premier.
 */
export interface Levier {
  code: string;
  libelle: string;
  criteres: string[] | "LEG";
}

const plage = (p: string, de: number, a: number) => Array.from({ length: a - de + 1 }, (_, i) => `${p}-${String(de + i).padStart(2, "0")}`);

export const LEVIERS: Levier[] = [
  { code: "volume", libelle: "Volume en baisse / peu de trafic", criteres: [...plage("VIS", 1, 8), "PROD-08", "PROD-09", "INN-01"] },
  { code: "transformation", libelle: "Transformation faible (demandes non confirmées)", criteres: ["PERF-12", "SOC-07", "PERF-14", "PERF-13", "PERF-01", "PERF-03", "SOC-03"] },
  { code: "conversion", libelle: "Taux de conversion faible", criteres: ["PERF-10", "PERF-11", "PROD-03", "PROD-04", "PERF-02", "PERF-14", "TECH-05"] },
  { code: "panier_abandon", libelle: "Abandon panier élevé", criteres: ["PERF-07", "PERF-13", "PERF-14", "LEG-07"] },
  { code: "panier_moyen", libelle: "Panier moyen / upsell faible", criteres: ["PROD-06", "PROD-07", "PERF-01", "PERF-08"] },
  { code: "qualite", libelle: "Erreurs RésaLive / annulations", criteres: ["RES-05", "SOC-04", "SOC-06", "PERF-03"] },
  { code: "pilotage", libelle: "Pilotage impossible (pas de données fiables)", criteres: [...plage("TRK", 1, 5), "SOC-07", "LEG-01"] },
  { code: "legal", libelle: "Risque légal", criteres: "LEG" },
];

export const criteresDuLevier = (l: Levier, id: string) => (l.criteres === "LEG" ? id.startsWith("LEG-") : l.criteres.includes(id));

export interface LevierEnRetard {
  code: string;
  libelle: string;
  /** Poids dans la priorisation : 3 = retard critique, 2 = en retard */
  poids: number;
  /** Constat chiffré qui justifie le retard */
  constat: string;
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/**
 * Indicateurs en retard d'après les données SpeedResa (§ 2 à 4).
 * Conversion : signalée quand le trafic mensuel est importé. Abandon panier : signalé quand Google Analytics 4
 * mesure les débuts de réservation et les achats du site.
 */
export function leviersEnRetard(m: ClientMetrics | null, legauxNon: string[] = []): LevierEnRetard[] {
  const out: LevierEnRetard[] = [];
  const L = (code: string) => LEVIERS.find((l) => l.code === code)!.libelle;
  if (m) {
    const critique = m.alertes.some((a) => a.niveau === "critique");
    if (m.evol_90j !== null && m.evol_90j <= -0.15) out.push({ code: "volume", libelle: L("volume"), poids: m.evol_90j <= -0.4 || critique ? 3 : 2, constat: `Volume 90 j en baisse de ${pct(-m.evol_90j)} sur un an.` });
    else if (m.jours_sans_dossier !== null && m.jours_sans_dossier >= 30) out.push({ code: "volume", libelle: L("volume"), poids: 3, constat: `Aucun dossier depuis ${m.jours_sans_dossier} jours.` });
    if (m.dossiers_12m >= 10 && m.transformation < 0.2) out.push({ code: "transformation", libelle: L("transformation"), poids: m.transformation < 0.05 ? 3 : 2, constat: `Transformation de ${pct(m.transformation)} sur 12 mois (${m.confirmes_12m} confirmés sur ${m.dossiers_12m} dossiers).` });
    // Conversion du trafic (si le trafic mensuel est importé) : nettement sous la référence (Champions ou portefeuille)
    if (m.conversion != null && m.conversion_reference != null && m.conversion_reference > 0 && m.conversion < 0.7 * m.conversion_reference) {
      const manque = m.manque_a_gagner_mensuel ? ` Manque à gagner estimé : ${Math.round(m.manque_a_gagner_mensuel).toLocaleString("fr-FR")} € par mois.` : "";
      out.push({ code: "conversion", libelle: L("conversion"), poids: m.conversion < 0.4 * m.conversion_reference ? 3 : 2, constat: `Conversion du trafic de ${(m.conversion * 100).toFixed(2).replace(".", ",")} % contre ${(m.conversion_reference * 100).toFixed(2).replace(".", ",")} % (médiane ${m.conversion_reference_source === "Champions" ? "des Champions" : "du portefeuille"}).${manque}` });
    }
    // Abandon panier (GA4) : nettement au-dessus de la médiane du portefeuille, ou très élevé sans référence
    if (m.abandon_panier != null) {
      const ref = m.abandon_reference ?? null;
      const seuil = ref !== null ? Math.min(0.97, ref + 0.1) : 0.9;
      if (m.abandon_panier >= seuil) out.push({ code: "panier_abandon", libelle: L("panier_abandon"), poids: m.abandon_panier >= (ref !== null ? Math.min(0.98, ref + 0.2) : 0.95) ? 3 : 2, constat: `${pct(m.abandon_panier)} des réservations commencées sur le site ne sont pas finalisées${ref !== null ? ` (médiane du portefeuille : ${pct(ref)})` : ""}.` });
    }
    if (m.resalive_12m >= 10 && m.taux_erreur_resalive >= 0.05) out.push({ code: "qualite", libelle: L("qualite"), poids: m.taux_erreur_resalive >= 0.1 ? 3 : 2, constat: `${pct(m.taux_erreur_resalive)} d'erreurs RésaLive.` });
    else if (m.confirmes_12m + m.annules_12m >= 10 && m.taux_annulation >= 0.15) out.push({ code: "qualite", libelle: L("qualite"), poids: m.taux_annulation >= 0.25 ? 3 : 2, constat: `${pct(m.taux_annulation)} d'annulations.` });
  }
  if (legauxNon.length) out.push({ code: "legal", libelle: L("legal"), poids: 3, constat: `${legauxNon.length} obligation(s) légale(s) non respectée(s) : ${legauxNon.join(", ")}.` });
  return out;
}
