import type { Detecteur } from "./types";
import { TECH01, TECH02, TECH03, TECH04, TECH05, TECH06 } from "./detecteurs/technique";
import { TRK01, TRK02, TRK03, TRK04, TRK05 } from "./detecteurs/tracking";
import { LEG01, LEG02, LEG03, LEG04, LEG05, LEG06, LEG07, LEG08, LEG09 } from "./detecteurs/legal-index";
import { VIS01, VIS02, VIS03, VIS07 } from "./detecteurs/visibilite";
import { PERF01, PERF10, PERF11, PERF14 } from "./detecteurs/performance";
import { PROD03, PROD04, PROD09, VIS08 } from "./detecteurs/produits";
import { INN01, INN02, INN03, INN05 } from "./detecteurs/innovation";

/**
 * Registre des détecteurs : id du critère → fonction de détection.
 * Ajouter un critère = écrire un détecteur et l'ajouter ici, sans toucher au reste.
 * Ordre = ordre d'exécution : contrôles réseau rapides, puis navigateur (accueil),
 * puis fiches produits et tunnel, puis les analyses longues (PageSpeed, recherche IA).
 */
export const DETECTEURS: Detecteur[] = [
  // Lot 1
  TECH01, TECH02, TECH03, VIS07, LEG02, LEG05, LEG06, TRK03, TRK01, TRK04, LEG01, TECH05, TECH06,
  // Lot 2 — accueil, Google, pages légales
  TECH04, VIS01, VIS02, VIS03, TRK05, INN02, INN03, LEG09, LEG04,
  // Lot 2 — fiches produits et tunnel
  VIS08, PROD03, PROD09, LEG07, LEG03, LEG08, TRK02, PERF14, PERF01, PROD04, INN05,
  // Analyses longues
  PERF11, PERF10, INN01,
];

/** Rescan mensuel léger (cookies, mentions légales, module SpeedResa, certificat, PageSpeed). */
export const DETECTEURS_LEGERS = ["TECH-01", "LEG-01", "LEG-02", "TECH-06", "PERF-11"];

export const detecteur = (id: string) => DETECTEURS.find((d) => d.critereId === id);
