/**
 * Libellés et unités des paramètres de calcul modifiables dans l'administration.
 * « % » : valeur stockée en fraction (0,2) et saisie en pourcentage (20).
 */
export type Unite = "%" | "€" | "jours" | "pts" | "nb";

export const GROUPES_PARAMS: { titre: string; cle: string; params: [string, string, Unite][] }[] = [
  { titre: "Segments (score santé)", cle: "segments", params: [["champion", "Champion à partir de", "pts"], ["aActiver", "À activer à partir de", "pts"]] },
  { titre: "Usage", cle: "", params: [["seuilReservationEnLigne", "« Réservation en ligne » si transformation ≥", "%"]] },
  { titre: "Score santé : dynamique (35 pts)", cle: "sante", params: [
    ["dyn90Points", "Points évolution 90 j", "pts"], ["dyn30Points", "Points évolution 30 j", "pts"], ["dynBas", "Évolution donnant 0 point", "%"], ["dynHaut", "Évolution donnant tous les points", "%"], ["partNouveau", "Part des points sans base N-1", "%"]] },
  { titre: "Score santé : activité (25 pts)", cle: "sante", params: [
    ["recencePoints", "Points récence", "pts"], ["recenceMaxJours", "Récence pleine jusqu'à", "jours"], ["recenceZeroJours", "Récence nulle à partir de", "jours"], ["dossiers90Points", "Points dossiers 90 j", "pts"], ["dossiers90Cible", "Dossiers 90 j pour tous les points", "nb"]] },
  { titre: "Score santé : usage et qualité (40 pts)", cle: "sante", params: [
    ["transfoPoints", "Points transformation", "pts"], ["transfoCible", "Transformation pour tous les points", "%"], ["erreurPoints", "Points erreurs RésaLive", "pts"], ["erreurMax", "Taux d'erreur donnant 0 point", "%"], ["annulPoints", "Points annulations", "pts"], ["annulMax", "Taux d'annulation donnant 0 point", "%"]] },
  { titre: "Alertes critiques", cle: "alertes", params: [
    ["critiqueJoursSansDossier", "Aucun dossier depuis", "jours"], ["critiqueBaisse90", "Baisse du volume 90 j", "%"], ["critiqueBaisse90BaseMin", "… si le volume 90 j N-1 dépasse", "€"]] },
  { titre: "Alertes « à surveiller »", cle: "alertes", params: [
    ["surveillerBaisse90", "Baisse du volume 90 j", "%"], ["surveillerBaisse90BaseMin", "… si le volume 90 j N-1 dépasse", "€"], ["surveillerRatio30", "30 j / moyenne mensuelle sous", "%"], ["surveillerRatio30BaseMin", "… si la moyenne mensuelle dépasse", "€"],
    ["surveillerVolumeMin12m", "Volume 12 mois quasi nul sous", "€"], ["surveillerErreurTaux", "Erreurs RésaLive au-delà de", "%"], ["surveillerErreurMinDossiers", "… sur au moins (dossiers RésaLive)", "nb"],
    ["surveillerAnnulTaux", "Annulations au-delà de", "%"], ["surveillerAnnulMinDossiers", "… sur au moins (dossiers)", "nb"], ["baisseMaturitePoints", "Baisse de maturité entre deux audits au-delà de", "pts"]] },
  { titre: "Opportunités", cle: "opportunites", params: [
    ["potentielVaMin", "Potentiel : VA estimé d'au moins", "€"], ["potentielPartMax", "… et part captée sous", "%"], ["usageDossiersMin", "Usage : au moins (dossiers 12 mois)", "nb"], ["usageTransfoMax", "… et transformation sous", "%"],
    ["conversionDevisMin", "Conversion : au moins (devis 12 mois)", "nb"], ["conversionTransfoMax", "… et transformation sous", "%"], ["croissanceEvolMin", "Croissance : évolution 90 j d'au moins", "%"], ["croissanceVolumeMin", "… et volume 90 j d'au moins", "€"]] },
];

export const versSaisie = (v: number, u: Unite) => (u === "%" ? Math.round(v * 1000) / 10 : v);
export const depuisSaisie = (v: number, u: Unite) => (u === "%" ? v / 100 : v);
