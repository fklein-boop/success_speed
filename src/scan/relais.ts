import { rechercheIa } from "./ia";
import { domaineEnregistrable } from "./fetcher";

/**
 * VIS-04 (lot B3) : pages qui citent ou lient le site du client (mairies, CSE, offices de tourisme, presse, partenaires),
 * trouvées par la recherche web de Claude, comme pour INN-01. Le CSM coche ensuite les vrais relais.
 * Option plus complète et payante (liens entrants Ahrefs, Semrush, Majestic) : voir DECISIONS.md.
 */
export type TypeRelais = "mairie" | "CSE" | "office de tourisme" | "presse" | "annuaire" | "réseau social" | "partenaire";
export interface Relais { url: string; domaine: string; type: TypeRelais }

const TYPES: [TypeRelais, RegExp][] = [
  ["réseau social", /(facebook|instagram|linkedin|twitter|x\.com|tiktok|youtube|pinterest)\./i],
  ["annuaire", /pagesjaunes|annuaire|societe\.com|pappers|infogreffe|kompass|yelp|tripadvisor|cylex|hoodspot|mappy|petitfute|verif\.com|manageo|118712|justacote|waze|google\./i],
  ["mairie", /mairie|ville-|\.gouv\.fr|commune|agglo|metropole|departement|region-|cc-|communaute/i],
  ["CSE", /\bcse\b|cse[-.]|comite|\bce[-.]|ccas|amicale|cos-|cnas|leclubdesce/i],
  ["office de tourisme", /tourisme|office|^ot-|destination|visit/i],
  ["presse", /actu|journal|presse|ouest-france|ladepeche|lefigaro|leparisien|francebleu|france3|midilibre|lavoixdunord|letelegramme|lamontagne|leprogres|ledauphine|nicematin|sudouest|lest-?republicain|dna\.fr|news|tourmag|lechotouristique|airjournal/i],
];

export function typeRelais(url: string): TypeRelais {
  let host = url;
  try { host = new URL(url).hostname + new URL(url).pathname; } catch { /* url brute */ }
  return TYPES.find(([, re]) => re.test(host))?.[0] ?? "partenaire";
}

export async function chercherRelais(nom: string, domaine: string, recherche: typeof rechercheIa = rechercheIa): Promise<Relais[]> {
  const requetes = [
    `Trouve des pages web d'autres sites qui mentionnent ou recommandent "${domaine}" (hors le site ${domaine} lui-même) : partenaires, mairies, CSE, offices de tourisme, presse.`,
    `Quelles mairies ou collectivités citent l'agence de voyages "${nom}" sur leur site ?`,
    `Quels CSE, comités d'entreprise ou amicales recommandent l'agence de voyages "${nom}" ?`,
    `Quels offices de tourisme ou articles de presse locale parlent de l'agence de voyages "${nom}" ?`,
  ];
  const res = await Promise.allSettled(requetes.map((q) => recherche(q)));
  if (res.every((r) => r.status === "rejected")) throw (res[0] as PromiseRejectedResult).reason;
  const propre = domaineEnregistrable(domaine);
  const vus = new Map<string, Relais>();
  for (const r of res) {
    if (r.status !== "fulfilled") continue;
    for (const url of r.value.sources) {
      let d: string;
      try { d = domaineEnregistrable(new URL(url).hostname); } catch { continue; }
      if (d === propre || vus.has(url)) continue;
      vus.set(url, { url, domaine: d, type: typeRelais(url) });
    }
  }
  const ordre: TypeRelais[] = ["mairie", "CSE", "office de tourisme", "presse", "partenaire", "annuaire", "réseau social"];
  return [...vus.values()].sort((a, b) => ordre.indexOf(a.type) - ordre.indexOf(b.type)).slice(0, 30);
}
