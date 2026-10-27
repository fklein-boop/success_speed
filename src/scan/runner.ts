import { ScanContext } from "./context";
import { navigateurDisponible } from "./browser";
import { DETECTEURS } from "./registry";
import { etatDe, nonVerifiable, SiteProtegeError, type Detecteur, type Etat, type Resultat, type ScanDonnees } from "./types";

export interface Progression {
  critereId: string;
  etat: Etat;
  resultat?: Resultat;
  dureeMs?: number;
}

export interface ScanOptions {
  navigateur?: boolean;
  pagespeedKey?: string | null;
  placesKey?: string | null;
  /** Parcours du tunnel de réservation (désactivé par défaut : SCAN_TUNNEL=oui pour l'activer) */
  tunnel?: boolean;
  donnees?: ScanDonnees;
  detecteurs?: Detecteur[];
  onProgress?: (p: Progression) => Promise<void> | void;
}

export interface ScanSortie {
  mode: "navigateur" | "http";
  statut: "termine" | "auth" | "erreur";
  message: string | null;
  resultats: Map<string, Resultat>;
  captures: { nom: string; data: string }[];
}

/**
 * Exécute les détecteurs sur une URL. Ne dépend ni de la base ni de l'interface :
 * appelable par l'app interne, le worker ou le futur auto-audit public.
 * Un détecteur qui plante passe en « non vérifiable » ; le scan ne tombe jamais.
 */
export async function executerDetecteurs(url: string, opts: ScanOptions = {}): Promise<ScanSortie> {
  const navigateur = opts.navigateur ?? (await navigateurDisponible());
  const ctx = new ScanContext(url, {
    navigateur,
    pagespeedKey: opts.pagespeedKey ?? process.env.GOOGLE_PAGESPEED_API_KEY ?? null,
    placesKey: opts.placesKey ?? process.env.GOOGLE_PLACES_API_KEY ?? null,
    tunnel: opts.tunnel ?? process.env.SCAN_TUNNEL === "oui",
    donnees: opts.donnees,
  });
  const liste = opts.detecteurs ?? DETECTEURS;
  const resultats = new Map<string, Resultat>();

  try {
    await ctx.accueil();
  } catch (e) {
    const auth = e instanceof SiteProtegeError;
    const message = auth ? `Site derrière authentification (${(e as SiteProtegeError).url}) : scan arrêté.` : `Site injoignable : ${e instanceof Error ? e.message : "erreur"}.`;
    for (const d of liste) {
      const r = nonVerifiable(message);
      resultats.set(d.critereId, r);
      await opts.onProgress?.({ critereId: d.critereId, etat: "non_verifiable", resultat: r });
    }
    return { mode: navigateur ? "navigateur" : "http", statut: auth ? "auth" : "erreur", message, resultats, captures: [] };
  }

  // PageSpeed est lent (20 à 60 s) : on le lance tout de suite en parallèle
  if (liste.some((d) => d.critereId.startsWith("PERF-1"))) void ctx.pagespeed().catch(() => null);
  if (liste.some((d) => d.critereId.startsWith("VIS-0"))) void ctx.place().catch(() => null);

  const DELAI_CONTROLE_MS = Number(process.env.SCAN_DELAI_CONTROLE_MS ?? 120_000);
  for (const d of liste) {
    await opts.onProgress?.({ critereId: d.critereId, etat: "en_cours" });
    const debut = Date.now();
    let r: Resultat;
    try {
      // Un contrôle bloqué (page qui ne répond pas, navigateur figé) ne doit pas bloquer tout le scan
      let minuterie: ReturnType<typeof setTimeout> | undefined;
      r = await Promise.race([
        d.run(ctx),
        new Promise<never>((_, ko) => { minuterie = setTimeout(() => ko(new Error(`délai dépassé (${Math.round(DELAI_CONTROLE_MS / 1000)} s)`)), DELAI_CONTROLE_MS); }),
      ]).finally(() => clearTimeout(minuterie));
      if (d.navigateur && !navigateur && r.confiance === "haute") r = { ...r, confiance: "moyenne" };
    } catch (e) {
      r = nonVerifiable(`Contrôle impossible : ${e instanceof Error ? e.message : "erreur"}.`);
    }
    // Le navigateur était disponible mais le rendu de la page a échoué : on le dit, plutôt que « sans navigateur »
    if (ctx.erreurNavigateur && (/sans navigateur/i.test(r.texte) || (r.statut === null && /fiche|page|tunnel/i.test(r.texte))))
      r = { ...r, texte: `${r.texte.replace(/sans navigateur/i, "faute de rendu navigateur")} Rendu navigateur en échec : ${ctx.erreurNavigateur}` };
    resultats.set(d.critereId, r);
    await opts.onProgress?.({ critereId: d.critereId, etat: etatDe(r), resultat: r, dureeMs: Date.now() - debut });
  }
  return {
    mode: navigateur ? "navigateur" : "http", statut: "termine",
    message: navigateur ? null : "Mode sans navigateur : cookies, Consent Mode et rendu mobile vérifiés partiellement.",
    resultats, captures: ctx.captures,
  };
}
