import { decoder, liens as liensHtml, texteDe } from "./html";
import type { PageRendue } from "./browser";

/**
 * Fiches produits : découverte depuis la page d'accueil et analyse (photos, textes, blocs,
 * dates, données structurées). Fonctions pures, testées sur des pages d'exemple.
 */
export interface Fiche {
  url: string;
  titre: string;
  html: string;
  texte: string;
  /** Texte propre à la fiche (sans les blocs communs au site : menu, pied de page) */
  textePropre: string;
  /** null si les largeurs réelles sont inconnues (mode sans navigateur) */
  images: { src: string; largeur: number | null }[];
  prixBarres: string[];
  evenements: string[];
  rendue: boolean;
}

/** Gabarits d'URL de fiche produit (SpeedResa : /produit/package/<id>-<source>/<titre>/…). */
const MOTIF_FICHE = /\/(produit|product|fiche[-_]?produit|offre|voyage|circuit|sejour|séjour|croisiere)s?\/[^?#]*[a-z0-9-]{6,}/i;
const EXCLUS = /\/(search|recherche|result|contact|devis|quotation|panier|cart|compte|connexion|identification|login|blog|actualites?|news|mentions|cgv|conditions|tag|categorie|category)\b|\.(pdf|jpe?g|png|webp)$/i;

export function estLienFiche(href: string, domaine: string): boolean {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith(domaine)) return false;
    return MOTIF_FICHE.test(u.pathname) && !EXCLUS.test(u.pathname);
  } catch { return false; }
}

/** Clé d'unicité d'une fiche : identifiant SpeedResa si présent, sinon chemin sans paramètres. */
export function cleFiche(href: string): string {
  const u = new URL(href);
  const id = u.pathname.match(/\/produit\/\w+\/(\d+)-/)?.[1];
  return id ? `sr:${id}` : u.pathname.replace(/\/(from|date|nights)-[^/]*/g, "").replace(/\/$/, "");
}

export function liensFiches(liens: { href: string; texte: string }[], domaine: string): { href: string; texte: string }[] {
  const vus = new Map<string, { href: string; texte: string }>();
  for (const l of liens) {
    if (!estLienFiche(l.href, domaine)) continue;
    const href = l.href.split("#")[0].replace(/[?&]tab=[^&]*/, "");
    const k = cleFiche(href);
    const deja = vus.get(k);
    if (!deja) vus.set(k, { href, texte: l.texte });
    else if (l.texte.length > deja.texte.length) deja.texte = l.texte;
  }
  return [...vus.values()];
}

/** Date de départ codée dans l'URL SpeedResa (…/date-2027-03-08/…). */
export function dateDansUrl(href: string): Date | null {
  const m = href.match(/\/date-(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

const MOIS: Record<string, number> = { janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, décembre: 11 };

/** Dates de départ mentionnées dans un texte (JJ/MM/AAAA et « 8 mars 2027 »). */
export function datesDansTexte(t: string): Date[] {
  const out: Date[] = [];
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) out.push(new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])));
  for (const m of t.matchAll(/\b(\d{1,2})(?:er)?\s+(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(20\d{2})\b/gi)) {
    const mois = MOIS[m[2].toLowerCase()];
    if (mois !== undefined) out.push(new Date(Date.UTC(+m[3], mois, +m[1])));
  }
  return out.filter((d) => !isNaN(d.getTime()));
}

/** Texte propre à une page : lignes absentes de la page d'accueil (menu, pied de page retirés). */
export function textePropre(texte: string, texteAccueil: string): string {
  const communes = new Set(texteAccueil.split("\n").map((l) => l.trim()).filter((l) => l.length > 0));
  return texte.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !communes.has(l)).join("\n");
}

const mots = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9]+/g) ?? [];

/** Similarité de Jaccard sur des groupes de 5 mots (0 = textes différents, 1 = identiques). */
export function similarite(a: string, b: string): number {
  const g = (t: string) => { const m = mots(t); const s = new Set<string>(); for (let i = 0; i + 5 <= m.length; i++) s.add(m.slice(i, i + 5).join(" ")); return s; };
  const A = g(a), B = g(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Ressemblance entre deux libellés de produits (top ventes ↔ liens du site). */
export function ressemblanceTitres(a: string, b: string): number {
  const vides = new Set(["de", "du", "des", "la", "le", "les", "en", "et", "a", "au", "aux", "l", "d", "sur", "avec", "un", "une", "jours", "nuits", "j", "n"]);
  const A = new Set(mots(a).filter((m) => !vides.has(m) && m.length > 1));
  const B = new Set(mots(b).filter((m) => !vides.has(m) && m.length > 1));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

export const BLOCS: [string, RegExp][] = [
  ["programme / descriptif", /programme|itin[ée]raire|jour\s*1\b|j\s*1\s*[:\-–]|descriptif|au programme/i],
  ["prix", /\d[\d\s.]*\s?€|€\s?\d|\bprix\b|\btarifs?\b/i],
  ["inclus", /(le prix|prix|prestations?|tarif)\s+(comprend|incluse?s?)|\bcomprend\b|\binclus\b/i],
  ["non inclus", /ne comprend pas|non incluse?s?|non compris|en suppl[ée]ment/i],
  ["dates / disponibilités", /dates?\s+(et|de)\s+(tarifs?|d[ée]part)|d[ée]parts?\s+(le|du|les)|disponibilit|calendrier|\b\d{1,2}\/\d{1,2}\/20\d{2}\b/i],
];

/** Images de contenu (logos, icônes et pictogrammes exclus). */
export function imagesContenu(images: Fiche["images"]): Fiche["images"] {
  return images.filter((i) => !/logo|icon|picto|sprite|\.svg(\?|$)|avatar|flag|drapeau|facebook|instagram|tiktok|youtube|payment|paiement/i.test(i.src));
}

/** Analyse statique (sans navigateur) d'une page produit. */
export function ficheStatique(url: string, html: string, texteAccueil: string): Fiche {
  const texte = texteDe(html);
  const images: Fiche["images"] = [];
  const vus = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = m[0].match(/\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src || vus.has(src)) continue;
    vus.add(src);
    const w = m[0].match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1];
    const srcset = [...(m[0].match(/srcset\s*=\s*["']([^"']+)["']/i)?.[1] ?? "").matchAll(/(\d+)w/g)].map((x) => +x[1]);
    let abs = src;
    try { abs = new URL(decoder(src), url).toString(); } catch { /* relatif invalide */ }
    images.push({ src: abs, largeur: srcset.length ? Math.max(...srcset) : w ? +w : null });
  }
  const prixBarres = [...html.matchAll(/<(del|s|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => texteDe(m[2])).filter((t) => /\d/.test(t)).slice(0, 10);
  return { url, titre: texteDe(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""), html, texte, textePropre: textePropre(texte, texteAccueil), images, prixBarres, evenements: [], rendue: false };
}

export function ficheRendue(p: PageRendue, texteAccueil: string): Fiche {
  return { url: p.urlFinale, titre: p.titre, html: p.html, texte: p.texte, textePropre: textePropre(p.texte, texteAccueil), images: p.images, prixBarres: p.prixBarres, evenements: p.evenements, rendue: true };
}

/** Types schema.org trouvés dans le JSON-LD et les microdonnées d'une page. */
export function donneesStructurees(html: string): { types: string[]; prix: boolean } {
  const types = new Set<string>();
  let prix = false;
  const parcourir = (x: unknown) => {
    if (Array.isArray(x)) { x.forEach(parcourir); return; }
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    const t = o["@type"];
    for (const v of Array.isArray(t) ? t : [t]) if (typeof v === "string") types.add(v);
    if (o.price !== undefined || o.lowPrice !== undefined) prix = true;
    for (const v of Object.values(o)) if (v && typeof v === "object") parcourir(v);
  };
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { parcourir(JSON.parse(m[1].trim())); } catch { /* JSON-LD invalide */ }
  }
  for (const m of html.matchAll(/itemtype\s*=\s*["']https?:\/\/schema\.org\/(\w+)["']/gi)) types.add(m[1]);
  if (/itemprop\s*=\s*["'](price|lowPrice)["']/i.test(html)) prix = true;
  return { types: [...types], prix };
}

export { liensHtml };
