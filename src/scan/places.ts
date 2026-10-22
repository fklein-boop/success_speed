import { domaineEnregistrable } from "./fetcher";

/**
 * Fiche Google Business Profile via l'API Google Places (New).
 * Clé : GOOGLE_PLACES_API_KEY. Sans clé, les critères VIS-01/02/03 restent vérifiables
 * partiellement (liens du site) ou passent en « non vérifiable ».
 */
export interface FicheGoogle {
  id: string;
  nom: string;
  adresse: string | null;
  note: number | null;
  nbAvis: number;
  site: string | null;
  urlMaps: string | null;
  avis: { note: number; date: string | null; texte: string }[];
  /** OPERATIONAL, CLOSED_TEMPORARILY ou CLOSED_PERMANENTLY (businessStatus de l'API) */
  statut: string | null;
  /** Comment la fiche a été identifiée : place_id enregistré, site web identique, ou nom seul (à confirmer) */
  correspondance: "place_id" | "site" | "nom";
}

const CHAMPS = ["id", "displayName", "formattedAddress", "rating", "userRatingCount", "websiteUri", "googleMapsUri", "reviews", "businessStatus"];

interface PlaceApi {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  reviews?: { rating?: number; publishTime?: string; text?: { text?: string } }[];
  businessStatus?: string;
}

const versFiche = (p: PlaceApi, correspondance: FicheGoogle["correspondance"]): FicheGoogle => ({
  id: p.id,
  nom: p.displayName?.text ?? "",
  adresse: p.formattedAddress ?? null,
  note: p.rating ?? null,
  nbAvis: p.userRatingCount ?? 0,
  site: p.websiteUri ?? null,
  urlMaps: p.googleMapsUri ?? null,
  avis: (p.reviews ?? []).map((a) => ({ note: a.rating ?? 0, date: a.publishTime ?? null, texte: (a.text?.text ?? "").slice(0, 300) })),
  statut: p.businessStatus ?? null,
  correspondance,
});

const memeDomaine = (site: string | undefined, domaine: string) => {
  if (!site) return false;
  try { return domaineEnregistrable(new URL(site).hostname) === domaine; } catch { return false; }
};

/** Choisit, parmi les résultats de recherche, la fiche dont le site web est celui du client. */
export function choisirPlace(resultats: PlaceApi[], domaine: string): FicheGoogle | null {
  const parSite = resultats.find((p) => memeDomaine(p.websiteUri, domaine));
  if (parSite) return versFiche(parSite, "site");
  return resultats[0] ? versFiche(resultats[0], "nom") : null;
}

export async function chercherFicheGoogle(opts: { nom: string; domaine: string; placeId?: string | null; cle: string; fetcher?: typeof fetch }): Promise<FicheGoogle | null> {
  const f = opts.fetcher ?? fetch;
  const entetes = { "X-Goog-Api-Key": opts.cle, "Content-Type": "application/json" };
  if (opts.placeId) {
    const r = await f(`https://places.googleapis.com/v1/places/${encodeURIComponent(opts.placeId)}?languageCode=fr`, {
      headers: { ...entetes, "X-Goog-FieldMask": CHAMPS.join(",") }, signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return versFiche(await r.json() as PlaceApi, "place_id");
    if (r.status !== 404) throw new Error(`Google Places : erreur ${r.status}`);
  }
  // Recherche par nom d'agence puis par domaine du site
  let candidat: FicheGoogle | null = null;
  for (const requete of [`${opts.nom} agence de voyages`, opts.domaine]) {
    const r = await f("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { ...entetes, "X-Goog-FieldMask": CHAMPS.map((c) => `places.${c}`).join(",") },
      body: JSON.stringify({ textQuery: requete, languageCode: "fr", regionCode: "FR", pageSize: 5 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(r.status === 403 ? "Google Places : clé refusée (API non activée ?)" : `Google Places : erreur ${r.status}`);
    const j = await r.json() as { places?: PlaceApi[] };
    const fiche = choisirPlace(j.places ?? [], opts.domaine);
    if (fiche?.correspondance === "site") return fiche;
    candidat ??= fiche;
  }
  return candidat;
}

/** Lien direct vers les avis de la fiche (pour compter les réponses du propriétaire, que l'API ne donne pas). */
export const lienAvis = (f: { id: string }) => `https://search.google.com/local/reviews?placeid=${encodeURIComponent(f.id)}`;
export const STATUTS_FICHE: Record<string, string> = { CLOSED_PERMANENTLY: "définitivement fermé", CLOSED_TEMPORARILY: "temporairement fermé", OPERATIONAL: "ouvert" };
