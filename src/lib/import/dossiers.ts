/**
 * Lecture de l'export dossiers SpeedResa (extract du lundi ou onglet « 3. Métriques mensuelles »).
 * Module pur : utilisé dans le navigateur (lecture du fichier) et côté serveur (tests, seed).
 *
 * Seules les colonnes listées ici sont importées : aucune donnée nominative de voyageur
 * ne peut entrer dans l'application, même si un futur export en contenait.
 */

export const CHAMPS = {
  idAgence: { label: "IDagence", requis: true, alias: ["idagence", "agence", "codeagence"] },
  producteur: { label: "Dossier Producteur", requis: false, alias: ["dossierproducteur", "producteur"] },
  idResa: { label: "IDresa", requis: true, alias: ["idresa", "iddossier", "numerodossier", "dossier"] },
  voyage: { label: "Voyage", requis: false, alias: ["voyage", "produit"] },
  nomAgence: { label: "Nom de l'agence", requis: false, alias: ["nomdelagence", "nomagence"] },
  fournisseur: { label: "Nom du fournisseur", requis: false, alias: ["nomdufournisseur", "fournisseur"] },
  date: { label: "Date de réservation", requis: true, alias: ["datedereservation", "datereservation", "date"] },
  heure: { label: "Heure de réservation", requis: false, alias: ["heuredereservation", "heurereservation", "heure"] },
  pax: { label: "Nombre de paxs", requis: false, alias: ["nombredepaxs", "nombredepax", "paxs", "pax"] },
  statut: { label: "Statut du dossier", requis: true, alias: ["statutdudossier", "statutdossier", "statut"] },
  origine: { label: "Statut d'origine du dossier", requis: true, alias: ["statutdoriginedudossier", "statutdorigine", "origine"] },
  total: { label: "Total du dossier", requis: true, alias: ["totaldudossier", "totaldossier", "total", "montant"] },
  encaisse: { label: "Total encaissé", requis: false, alias: ["totalencaisse", "encaisse"] },
  erreurResalive: { label: "Erreur RésaLive", requis: true, alias: ["erreurresalive", "erreur"] },
  // Export enrichi (08_DEMANDES_EQUIPES_EXPORTS § 1) : colonnes facultatives, lues quand elles sont livrées
  idProduit: { label: "ID produit", requis: false, alias: ["idproduit", "produitid"] },
  canal: { label: "Origine", requis: false, alias: ["origine", "canal", "canaldevente"] },
  montantOptions: { label: "Montant options", requis: false, alias: ["montantoptions"] },
  montantAssurance: { label: "Montant assurance", requis: false, alias: ["montantassurance"] },
  dateConfirmation: { label: "Date de confirmation", requis: false, alias: ["datedeconfirmation", "dateconfirmation"] },
  emailRenseigne: { label: "Email renseigné", requis: false, alias: ["emailrenseigne"] },
  payeEnLigne: { label: "Payé en ligne", requis: false, alias: ["payeenligne", "montantpayeenligne"] },
} as const;

export type Champ = keyof typeof CHAMPS;
export type Mapping = Partial<Record<Champ, number>>;

export interface DossierImport {
  idResa: string;
  idAgence: string;
  producteur: boolean;
  voyage: string | null;
  nomAgence: string | null;
  fournisseur: string | null;
  date: string; // AAAA-MM-JJ
  heure: string | null;
  pax: number | null;
  statut: string;
  origine: string;
  total: number;
  encaisse: number;
  erreurResalive: boolean;
  /** Export enrichi : absents (undefined) tant que la colonne n'est pas livrée */
  idProduit?: string | null;
  canal?: string | null;
  montantOptions?: number | null;
  montantAssurance?: number | null;
  dateConfirmation?: string | null;
  emailRenseigne?: boolean | null;
  payeEnLigne?: number | null;
}

/** Normalise un nom de colonne : minuscules, sans accents, sans espaces ni ponctuation. */
export function normalizeHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Associe chaque champ à une colonne. `memorise` = correspondances choisies précédemment
 * par l'utilisateur (nom de colonne normalisé → champ).
 */
export function detectColumns(headers: unknown[], memorise: Record<string, Champ> = {}) {
  const norm = headers.map(normalizeHeader);
  const mapping: Mapping = {};
  for (const [i, n] of norm.entries()) {
    const champ = memorise[n];
    if (champ && mapping[champ] === undefined) mapping[champ] = i;
  }
  for (const [champ, def] of Object.entries(CHAMPS) as [Champ, (typeof CHAMPS)[Champ]][]) {
    if (mapping[champ] !== undefined) continue;
    // Correspondance exacte d'abord, dans l'ordre des alias (du plus précis au plus large)
    for (const a of def.alias) {
      const i = norm.findIndex((n, idx) => n === a && !Object.values(mapping).includes(idx));
      if (i >= 0) { mapping[champ] = i; break; }
    }
  }
  const manquants = (Object.keys(CHAMPS) as Champ[]).filter((c) => CHAMPS[c].requis && mapping[c] === undefined);
  return { mapping, manquants };
}

/** Repère la ligne d'en-tête (celle qui contient IDresa) dans une feuille. */
export function findHeaderRow(matrix: unknown[][], max = 20): number {
  for (let i = 0; i < Math.min(max, matrix.length); i++) {
    const n = (matrix[i] ?? []).map(normalizeHeader);
    if (n.includes("idresa") && n.includes("idagence")) return i;
  }
  return -1;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Date française JJ/MM/AAAA, ISO, objet Date ou numéro de série Excel → AAAA-MM-JJ */
export function parseDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Les dates Excel lues avec cellDates sont à minuit heure locale : on lit en local.
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === "number" && isFinite(v)) {
    const d = new Date(Math.round((Math.floor(v) - 25569) * 86_400_000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Montant « 1 234,56 », « 1234.56 » ou nombre → nombre (NaN si illisible). */
export function parseAmount(v: unknown): number {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return 0;
  let s = String(v).replace(/[\s  €]/g, "");
  if (s === "") return 0;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else s = s.replace(",", ".");
  return Number(s);
}

function parseTime(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    const secs = Math.round((v - Math.floor(v)) * 86400);
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor((secs % 3600) / 60))}`;
  }
  if (v instanceof Date) return `${pad(v.getHours())}:${pad(v.getMinutes())}`;
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${pad(+m[1])}:${m[2]}` : null;
}

const str = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};
const oui = (v: unknown) => /^(oui|yes|true|1|o)$/i.test(String(v ?? "").trim());

export interface Anomalies {
  lignesIgnorees: { ligne: number; raison: string }[];
  datesFutures: string[];
  montantsNegatifs: string[];
  doublons: string[];
}

/** Convertit les lignes (sans l'en-tête) en dossiers + anomalies. */
export function rowsToDossiers(rows: unknown[][], mapping: Mapping, today = new Date().toISOString().slice(0, 10)) {
  const get = (r: unknown[], c: Champ) => (mapping[c] === undefined ? undefined : r[mapping[c]!]);
  const out = new Map<string, DossierImport>();
  const anomalies: Anomalies = { lignesIgnorees: [], datesFutures: [], montantsNegatifs: [], doublons: [] };

  rows.forEach((r, i) => {
    const ligne = i + 2;
    if (!r || r.every((c) => c === null || c === undefined || c === "")) return;
    const idResa = str(get(r, "idResa"));
    const idAgence = str(get(r, "idAgence"));
    const date = parseDate(get(r, "date"));
    const statut = str(get(r, "statut"));
    if (!idResa || !idAgence) return void anomalies.lignesIgnorees.push({ ligne, raison: "IDresa ou IDagence manquant" });
    if (!date) return void anomalies.lignesIgnorees.push({ ligne, raison: `Date illisible (dossier ${idResa})` });
    if (!statut) return void anomalies.lignesIgnorees.push({ ligne, raison: `Statut manquant (dossier ${idResa})` });
    const total = parseAmount(get(r, "total"));
    if (Number.isNaN(total)) return void anomalies.lignesIgnorees.push({ ligne, raison: `Montant illisible (dossier ${idResa})` });
    const encaisse = parseAmount(get(r, "encaisse"));
    const pax = Number(get(r, "pax"));
    const opt = (c: Champ) => mapping[c] !== undefined;
    const montant = (c: Champ) => { if (!opt(c)) return undefined; const v = get(r, c); if (v === null || v === undefined || v === "") return null; const n = parseAmount(v); return Number.isNaN(n) ? null : n; };

    const d: DossierImport = {
      idResa: idResa.replace(/\.0$/, ""),
      idAgence: idAgence.toUpperCase(),
      producteur: oui(get(r, "producteur")),
      voyage: str(get(r, "voyage")),
      nomAgence: str(get(r, "nomAgence")),
      fournisseur: str(get(r, "fournisseur")),
      date,
      heure: parseTime(get(r, "heure")),
      pax: Number.isFinite(pax) ? pax : null,
      statut,
      origine: str(get(r, "origine")) ?? "",
      total,
      encaisse: Number.isNaN(encaisse) ? 0 : encaisse,
      erreurResalive: oui(get(r, "erreurResalive")),
      ...(opt("idProduit") ? { idProduit: str(get(r, "idProduit"))?.replace(/\.0$/, "") ?? null } : {}),
      ...(opt("canal") ? { canal: str(get(r, "canal"))?.toLowerCase() ?? null } : {}),
      ...(opt("montantOptions") ? { montantOptions: montant("montantOptions") } : {}),
      ...(opt("montantAssurance") ? { montantAssurance: montant("montantAssurance") } : {}),
      ...(opt("dateConfirmation") ? { dateConfirmation: parseDate(get(r, "dateConfirmation")) } : {}),
      ...(opt("emailRenseigne") ? { emailRenseigne: str(get(r, "emailRenseigne")) === null ? null : oui(get(r, "emailRenseigne")) } : {}),
      ...(opt("payeEnLigne") ? { payeEnLigne: montant("payeEnLigne") } : {}),
    };
    if (out.has(d.idResa)) anomalies.doublons.push(d.idResa);
    if (d.date > today) anomalies.datesFutures.push(d.idResa);
    if (d.total < 0) anomalies.montantsNegatifs.push(d.idResa);
    out.set(d.idResa, d); // en cas de doublon, la dernière ligne l'emporte
  });

  const list = [...out.values()];
  let debut: string | null = null, fin: string | null = null;
  for (const d of list) {
    if (!debut || d.date < debut) debut = d.date;
    if (!fin || d.date > fin) fin = d.date;
  }
  return { dossiers: list, anomalies, periode: { debut, fin } };
}

const ENRICHIS = ["idProduit", "canal", "montantOptions", "montantAssurance", "dateConfirmation", "emailRenseigne", "payeEnLigne"] as const;

/** Champs comparés pour savoir si un dossier connu a changé. */
export function dossierChanged(a: DossierImport, b: DossierImport): boolean {
  return a.statut !== b.statut || Math.abs(a.total - b.total) > 0.005 || Math.abs(a.encaisse - b.encaisse) > 0.005
    || a.erreurResalive !== b.erreurResalive || a.date !== b.date || a.idAgence !== b.idAgence
    || ENRICHIS.some((k) => b[k] !== undefined && (a[k] ?? null) !== (b[k] ?? null));
}
