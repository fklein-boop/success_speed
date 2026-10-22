/**
 * État des services externes (Administration → État des services) : dernier appel réussi ou en échec
 * de chaque clé (Places, PageSpeed, Anthropic, Resend, GA4) et du worker de scan.
 * Enregistré dans le paramètre « etat_services » ; sans base (tests, scan isolé), rien n'est écrit.
 * Les succès sont écrits au plus toutes les 5 minutes par processus, pour ne pas multiplier les écritures.
 */
export type Service = "places" | "pagespeed" | "anthropic" | "resend" | "ga4" | "worker";
export interface EtatService { dernierSucces?: string; dernierEchec?: string; message?: string }

export const SERVICES: { id: Service; nom: string; variable: string; criteres: string }[] = [
  { id: "places", nom: "Google Places", variable: "GOOGLE_PLACES_API_KEY", criteres: "VIS-01, VIS-02, VIS-03 (fiche, note, avis, fermeture)" },
  { id: "pagespeed", nom: "Google PageSpeed", variable: "GOOGLE_PAGESPEED_API_KEY", criteres: "PERF-10, PERF-11 (sans clé : quota partagé, souvent refusé)" },
  { id: "anthropic", nom: "Anthropic (Claude)", variable: "ANTHROPIC_API_KEY", criteres: "LEG-02, LEG-06, PROD-03, PROD-04, INN-01, textes de restitution" },
  { id: "resend", nom: "Resend (emails)", variable: "RESEND_API_KEY", criteres: "liens de connexion, questionnaires, récapitulatif du lundi, restitution" },
  { id: "ga4", nom: "Google Analytics 4", variable: "GA4_CREDENTIALS", criteres: "PERF-04, PERF-07, TRK-01, conversion web" },
  { id: "worker", nom: "Worker de scan (navigateur)", variable: "SCAN_MODE=worker", criteres: "LEG-01, TRK-04, PERF-01, PROD-03, PERF-14, TECH-04 (monitoring), captures" },
];

const dernierEcrit = new Map<Service, number>();

export async function noterService(service: Service, ok: boolean, message?: string) {
  if (process.env.VITEST) return;
  const t = Date.now();
  if (ok && (dernierEcrit.get(service) ?? 0) > t - 5 * 60_000) return;
  dernierEcrit.set(service, t);
  try {
    const [{ getDb }, { parametres }, { eq }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
    const db = await getDb();
    const [p] = await db.select().from(parametres).where(eq(parametres.cle, "etat_services"));
    const etat = { ...((p?.valeur as Record<string, EtatService>) ?? {}) };
    const now = new Date(t).toISOString();
    etat[service] = ok ? { ...etat[service], dernierSucces: now } : { ...etat[service], dernierEchec: now, message: (message ?? "erreur").slice(0, 300) };
    await db.insert(parametres).values({ cle: "etat_services", valeur: etat }).onConflictDoUpdate({ target: parametres.cle, set: { valeur: etat, modifieLe: new Date() } });
  } catch { /* état indicatif : jamais bloquant */ }
}

/** Enveloppe un appel : note le succès ou l'échec, et relance l'erreur. */
export async function suivre<T>(service: Service, f: () => Promise<T>): Promise<T> {
  try { const r = await f(); void noterService(service, true); return r; }
  catch (e) { void noterService(service, false, e instanceof Error ? e.message : String(e)); throw e; }
}
