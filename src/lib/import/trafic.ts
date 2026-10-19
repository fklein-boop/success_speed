/**
 * Import du trafic mensuel des sites clients (onglet « 4. Métriques GTM » ou fichier équivalent).
 * Fonctions pures : lecture des colonnes de mois, des lignes, et rapprochement des noms avec les clients.
 */

const MOIS: Record<string, number> = {
  january: 1, jan: 1, janvier: 1, janv: 1, february: 2, feb: 2, fevrier: 2, fevr: 2, fev: 2, march: 3, mar: 3, mars: 3,
  april: 4, apr: 4, avril: 4, avr: 4, may: 5, mai: 5, june: 6, jun: 6, juin: 6, july: 7, jul: 7, juillet: 7, juil: 7,
  august: 8, aug: 8, aout: 8, september: 9, sep: 9, sept: 9, septembre: 9, october: 10, oct: 10, octobre: 10,
  november: 11, nov: 11, novembre: 11, december: 12, dec: 12, decembre: 12,
};

export const normaliser = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Mois d'un en-tête de colonne, au format AAAA-MM : « May », « mai 2026 », « 2026-05 », « 05/2026 »,
 * date Excel (nombre de jours depuis 1900). Sans année, on prend `anneeDefaut`.
 */
export function moisDeEntete(h: unknown, anneeDefaut: number): string | null {
  const ym = (y: number, m: number) => (m >= 1 && m <= 12 && y >= 2000 && y < 2100 ? `${y}-${String(m).padStart(2, "0")}` : null);
  if (typeof h === "number" && h > 30000 && h < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + h * 86_400_000);
    return ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
  }
  if (h instanceof Date) return ym(h.getUTCFullYear(), h.getUTCMonth() + 1);
  const t = normaliser(String(h ?? ""));
  if (!t) return null;
  let m = t.match(/^(\d{4}) (\d{1,2})$/) ?? null;
  if (m) return ym(+m[1], +m[2]);
  m = t.match(/^(\d{1,2}) (\d{4})$/);
  if (m) return ym(+m[2], +m[1]);
  m = t.match(/^([a-z]+)(?: (\d{2}|\d{4}))?$/);
  if (m && MOIS[m[1]]) return ym(m[2] ? (m[2].length === 2 ? 2000 + +m[2] : +m[2]) : anneeDefaut, MOIS[m[1]]);
  return null;
}

/**
 * Année par défaut des mois sans année : la plus récente telle qu'aucun mois ne dépasse le mois de référence
 * (ex. données au 12/10/2026, colonnes mai à septembre → 2026).
 */
export function anneeParDefaut(entetes: unknown[], reference: string): number {
  const [y, mRef] = reference.split("-").map(Number);
  const mois = entetes.map((h) => { const t = normaliser(String(h ?? "")); return MOIS[t] ?? null; }).filter((x): x is number => x !== null);
  return mois.some((m) => m > mRef) ? y - 1 : y;
}

export interface LigneTrafic { nom: string; valeurs: Record<string, number> }

/**
 * Lit un tableau « nom du client | mois 1 | mois 2 | … ». Les cellules vides et les 0 sont considérés
 * comme « non mesuré » (un site en ligne n'a jamais zéro visite : le marqueur n'était pas encore posé).
 */
export function lireTableauTrafic(rows: unknown[][], anneeDefaut: number): { mois: string[]; lignes: LigneTrafic[]; ignorees: string[] } {
  const iEntete = rows.findIndex((r) => r.slice(1).filter((h) => moisDeEntete(h, anneeDefaut)).length >= 1);
  if (iEntete < 0) throw new Error("Aucune colonne de mois reconnue (ex. « May », « mai 2026 », « 2026-05 »).");
  const entete = rows[iEntete];
  const colonnes = entete.map((h, i) => ({ i, mois: i === 0 ? null : moisDeEntete(h, anneeDefaut) })).filter((c): c is { i: number; mois: string } => !!c.mois);
  const lignes: LigneTrafic[] = [];
  const ignorees: string[] = [];
  for (const r of rows.slice(iEntete + 1)) {
    const nom = String(r[0] ?? "").trim();
    if (!nom) continue;
    const valeurs: Record<string, number> = {};
    for (const c of colonnes) {
      const v = r[c.i];
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[\s  ]/g, "").replace(",", "."));
      if (Number.isFinite(n) && n > 0) valeurs[c.mois] = (valeurs[c.mois] ?? 0) + Math.round(n);
    }
    if (Object.keys(valeurs).length) lignes.push({ nom, valeurs });
    else ignorees.push(nom);
  }
  return { mois: [...new Set(colonnes.map((c) => c.mois))].sort(), lignes, ignorees };
}

const VIDES = new Set(["de", "du", "des", "la", "le", "les", "l", "d", "et", "voyages", "voyage", "agence", "sas", "sarl", "www", "fr", "com"]);
const jetons = (s: string) => { const t = normaliser(s).split(" ").filter(Boolean); const u = t.filter((x) => !VIDES.has(x)); return new Set(u.length ? u : t); };
const domaineCompact = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "").split(".")[0].replace(/[^a-z0-9]/g, ""); } catch { return ""; } };

export interface ClientRef { id: string; nom: string; urls: string[] }

/** Ressemblance entre un nom du fichier et un client (1 = certain). */
export function ressemblanceClient(nom: string, c: ClientRef): number {
  const n = normaliser(nom), compact = n.replace(/ /g, "");
  if (!compact) return 0;
  if (n === normaliser(c.nom) || compact === normaliser(c.nom).replace(/ /g, "") || c.id.toLowerCase() === compact) return 1;
  if (c.urls.some((u) => domaineCompact(u) === compact)) return 1;
  const a = jetons(nom), b = jetons(c.nom);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return a.size ? inter / a.size : 0;
}

/**
 * Client proposé pour chaque nom : correspondance mémorisée, sinon meilleur score.
 * « sur » = rapprochement certain et sans ambiguïté ; sinon à confirmer dans l'aperçu.
 */
export function rapprocher(nom: string, clients: ClientRef[], memo: Record<string, string>): { clientId: string | null; score: number; sur: boolean } {
  const m = memo[normaliser(nom)];
  if (m !== undefined) return { clientId: m || null, score: 1, sur: true };
  const scores = clients.map((c) => ({ id: c.id, s: ressemblanceClient(nom, c) })).sort((x, y) => y.s - x.s);
  const [premier, second] = scores;
  if (!premier || premier.s < 0.5) return { clientId: null, score: premier?.s ?? 0, sur: false };
  const sur = premier.s === 1 && (!second || second.s < 1);
  return { clientId: premier.id, score: premier.s, sur };
}
