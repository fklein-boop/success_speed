import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Récupération « polie » des pages : user-agent identifié, 1 requête par seconde maximum
 * par domaine, délai maximal par page, redirections suivies à la main (contrôle de chaque saut),
 * jamais d'adresse interne (protection SSRF), jamais de POST.
 */
export const USER_AGENT = `Mozilla/5.0 (compatible; SpeedmediaAuditBot/1.0; +${process.env.SCAN_CONTACT_URL ?? "https://www.speedmedia.fr/audit-bot"})`;
const TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS ?? 15000);
const TAILLE_MAX = 4 * 1024 * 1024;

const dernier = new Map<string, number>();
async function attendreTour(host: string) {
  const intervalle = Number(process.env.SCAN_INTERVALLE_MS ?? 1000);
  const prochain = Math.max(Date.now(), (dernier.get(host) ?? 0) + intervalle);
  dernier.set(host, prochain);
  const attente = prochain - Date.now();
  if (attente > 0) await new Promise((r) => setTimeout(r, attente));
}

export function ipPrivee(ip: string): boolean {
  if (isIP(ip) === 6) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80")) return true;
    const v4 = l.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return v4 ? ipPrivee(v4[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export class UrlRefuseeError extends Error {}

/** Vérifie qu'une URL publique peut être scannée (http/https, pas d'adresse interne). */
export async function verifierUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UrlRefuseeError("URL invalide"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlRefuseeError("Seules les URL http(s) sont acceptées");
  if (u.username || u.password) throw new UrlRefuseeError("URL avec identifiants refusée");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!(process.env.NODE_ENV === "test" && process.env.SCAN_AUTORISER_LOCAL === "1") && (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal"))) throw new UrlRefuseeError("Adresse interne refusée");
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new UrlRefuseeError(`Domaine introuvable : ${host}`); });
  // Exception réservée aux tests automatisés (pages d'exemple servies en local)
  const testsLocaux = process.env.NODE_ENV === "test" && process.env.SCAN_AUTORISER_LOCAL === "1";
  if (!testsLocaux && ips.some((x) => ipPrivee(x.address))) throw new UrlRefuseeError("Adresse interne refusée");
  return u;
}

export interface Reponse {
  url: string;
  urlFinale: string;
  statut: number;
  headers: Record<string, string>;
  setCookies: string[];
  corps: string;
  redirections: string[];
  dureeMs: number;
}

export async function recuperer(url: string, opts: { maxRedirections?: number; accept?: string } = {}): Promise<Reponse> {
  const debut = Date.now();
  const redirections: string[] = [];
  let courante = url;
  for (let i = 0; i <= (opts.maxRedirections ?? 6); i++) {
    const u = await verifierUrl(courante);
    await attendreTour(u.hostname);
    const res = await fetch(u, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": USER_AGENT, "accept-language": "fr-FR,fr;q=0.9", accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      redirections.push(courante);
      courante = new URL(res.headers.get("location")!, courante).toString();
      await res.body?.cancel();
      continue;
    }
    const buf = await lireLimite(res);
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return {
      url, urlFinale: courante, statut: res.status, headers, setCookies: res.headers.getSetCookie?.() ?? [],
      corps: buf, redirections, dureeMs: Date.now() - debut,
    };
  }
  throw new Error("Trop de redirections");
}

async function lireLimite(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > TAILLE_MAX) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const all = new Uint8Array(n > TAILLE_MAX ? chunks.reduce((s, c) => s + c.length, 0) : n);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  return new TextDecoder("utf-8").decode(all);
}

/** Domaine enregistrable (exemple.fr pour www.exemple.fr ; gère quelques suffixes à deux niveaux). */
export function domaineEnregistrable(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  const deux = ["co.uk", "org.uk", "com.au", "co.nz", "com.br", "co.jp", "asso.fr", "gouv.fr", "com.fr", "tm.fr"];
  const fin2 = parts.slice(-2).join(".");
  return deux.includes(fin2) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}
