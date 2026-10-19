/**
 * Seuils paramétrables (02_REGLES_DE_CALCUL.md). Les valeurs ci-dessous sont les
 * valeurs de départ ; elles sont surchargées par la table `parametres` (clé "metrics").
 */
export const DEFAULT_METRICS_PARAMS = {
  agencesDemo: ["D01", "D10"],
  statutsAnnules: ["Annulée par l'agence", "Annulée par le client"],
  statutsConfirmes: ["Validée", "Enregistrée", "En Cours", "Attente règlement"],

  // Usage
  seuilReservationEnLigne: 0.2,

  // Score santé
  sante: {
    dyn90Points: 25,
    dyn30Points: 10,
    dynBas: -0.5,
    dynHaut: 0.5,
    partNouveau: 0.6,
    recencePoints: 15,
    recenceMaxJours: 7,
    recenceZeroJours: 60,
    dossiers90Points: 10,
    dossiers90Cible: 30,
    transfoPoints: 20,
    transfoCible: 0.5,
    erreurPoints: 10,
    erreurMax: 0.1,
    annulPoints: 10,
    annulMax: 0.25,
  },
  segments: { champion: 65, aActiver: 45 },

  alertes: {
    critiqueJoursSansDossier: 30,
    critiqueBaisse90: -0.4,
    critiqueBaisse90BaseMin: 20000,
    surveillerBaisse90: -0.2,
    surveillerBaisse90BaseMin: 5000,
    surveillerRatio30: 0.7,
    surveillerRatio30BaseMin: 5000,
    surveillerVolumeMin12m: 10000,
    surveillerErreurTaux: 0.05,
    surveillerErreurMinDossiers: 30,
    surveillerAnnulTaux: 0.15,
    surveillerAnnulMinDossiers: 20,
    baisseMaturitePoints: 10,
  },

  opportunites: {
    potentielVaMin: 1_000_000,
    potentielPartMax: 0.05,
    usageDossiersMin: 30,
    usageTransfoMax: 0.1,
    conversionDevisMin: 100,
    conversionTransfoMax: 0.35,
    croissanceEvolMin: 0.3,
    croissanceVolumeMin: 20000,
  },
};

export type MetricsParams = typeof DEFAULT_METRICS_PARAMS;

/** Fusion profonde d'une surcharge partielle (issue de la base) avec les valeurs par défaut. */
export function mergeParams(override: unknown): MetricsParams {
  const base = structuredClone(DEFAULT_METRICS_PARAMS) as Record<string, unknown>;
  if (!override || typeof override !== "object") return base as MetricsParams;
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") {
      base[k] = { ...(base[k] as object), ...(v as object) };
    } else if (v !== undefined) {
      base[k] = v;
    }
  }
  return base as MetricsParams;
}
