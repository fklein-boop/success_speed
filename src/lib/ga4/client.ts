import "server-only";
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { suivre } from "@/lib/services/etat";

/**
 * Accès en lecture à Google Analytics 4 par un compte de service (audit-csm@….iam.gserviceaccount.com).
 * Clé : variable GA4_CREDENTIALS (contenu JSON, ou JSON encodé en base64) ou GA4_CREDENTIALS_FILE (chemin du fichier,
 * pratique en local). La clé n'est jamais écrite dans les journaux ni renvoyée à l'interface.
 * Sans dépendance : jeton OAuth signé localement (JWT RS256), puis appels REST (Data API et Admin API, lecture seule).
 */
export interface Identifiants { client_email: string; private_key: string }

export function lireIdentifiants(): Identifiants | null {
  try {
    let brut = process.env.GA4_CREDENTIALS?.trim();
    if (!brut && process.env.GA4_CREDENTIALS_FILE) brut = readFileSync(process.env.GA4_CREDENTIALS_FILE, "utf8");
    if (!brut) return null;
    const json = brut.startsWith("{") ? brut : Buffer.from(brut, "base64").toString("utf8");
    const j = JSON.parse(json) as Partial<Identifiants>;
    return j.client_email && j.private_key ? { client_email: j.client_email, private_key: j.private_key } : null;
  } catch { return null; }
}

export const ga4Configure = () => lireIdentifiants() !== null;
export const emailCompteService = () => lireIdentifiants()?.client_email ?? null;

export class Ga4Error extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

type Fetch = typeof fetch;
let fetcher: Fetch = (...a) => fetch(...a);
let jetonCache: { valeur: string; expire: number; email: string } | null = null;
/** Pour les tests : remplace l'accès réseau. */
export function definirFetch(f: Fetch | null) { fetcher = f ?? ((...a) => fetch(...a)); jetonCache = null; }

const b64url = (b: string) => Buffer.from(b).toString("base64url");

async function jeton(): Promise<string> {
  const id = lireIdentifiants();
  if (!id) throw new Ga4Error("Clé Google Analytics non configurée (variable GA4_CREDENTIALS).", 503);
  if (jetonCache && jetonCache.email === id.client_email && jetonCache.expire > Date.now() + 60_000) return jetonCache.valeur;
  const t = Math.floor(Date.now() / 1000);
  const entete = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corps = b64url(JSON.stringify({ iss: id.client_email, scope: "https://www.googleapis.com/auth/analytics.readonly", aud: "https://oauth2.googleapis.com/token", iat: t, exp: t + 3600 }));
  let signature: string;
  try { signature = createSign("RSA-SHA256").update(`${entete}.${corps}`).sign(id.private_key, "base64url"); }
  catch { throw new Ga4Error("Clé Google Analytics illisible : vérifiez le fichier JSON du compte de service.", 503); }
  const r = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${entete}.${corps}.${signature}` }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Ga4Error("Google refuse la clé du compte de service (clé révoquée ou supprimée ?).", 503);
  const j = await r.json() as { access_token: string; expires_in: number };
  jetonCache = { valeur: j.access_token, expire: Date.now() + j.expires_in * 1000, email: id.client_email };
  return j.access_token;
}

async function appel<T>(url: string, body?: unknown): Promise<T> {
  return suivre("ga4", () => appelBrut<T>(url, body));
}

async function appelBrut<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetcher(url, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${await jeton()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const err = !r.ok ? ((await r.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message : null;
  if (r.status === 403 && /has not been used|is disabled/i.test(err ?? "")) throw new Ga4Error("API Google Analytics non activée dans le projet Google Cloud « audit-speedresa » (activez « Google Analytics Data API » et « Google Analytics Admin API »).", 403);
  if (r.status === 403) throw new Ga4Error("Accès refusé : ajoutez le compte de service en « Lecteur » sur la propriété Google Analytics.", 403);
  if (r.status === 429) throw new Ga4Error("Quota Google Analytics atteint : réessayez plus tard.", 429);
  if (!r.ok) throw new Ga4Error(`Google Analytics : ${err ?? `erreur ${r.status}`}`, r.status);
  return r.json() as Promise<T>;
}

/** Propriétés GA4 auxquelles le compte de service a accès. */
export async function proprietes(): Promise<{ id: string; nom: string; compte: string }[]> {
  const j = await appel<{ accountSummaries?: { displayName: string; propertySummaries?: { property: string; displayName: string }[] }[] }>("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
  return (j.accountSummaries ?? []).flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ id: p.property.replace("properties/", ""), nom: p.displayName, compte: a.displayName })));
}

export interface Dimension { apiName: string; nom: string; personnalisee: boolean }

/** Dimensions disponibles sur la propriété (dont les dimensions personnalisées déclarées dans GA4). */
export async function dimensions(propertyId: string): Promise<Dimension[]> {
  const j = await appel<{ dimensions?: { apiName: string; uiName: string; customDefinition?: boolean }[] }>(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/metadata`);
  return (j.dimensions ?? []).map((d) => ({ apiName: d.apiName, nom: d.uiName, personnalisee: !!d.customDefinition }));
}

export interface LigneRapport { dims: string[]; mets: number[] }

/** Rapport GA4 (toutes les pages de résultats). */
export async function rapport(propertyId: string, req: { dateRanges: { startDate: string; endDate: string }[]; dimensions: string[]; metrics: string[]; dimensionFilter?: unknown }): Promise<LigneRapport[]> {
  const out: LigneRapport[] = [];
  const limite = 100000;
  for (let offset = 0; offset < 2_000_000; offset += limite) {
    const j = await appel<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]; rowCount?: number }>(
      `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`,
      { ...req, dimensions: req.dimensions.map((name) => ({ name })), metrics: req.metrics.map((name) => ({ name })), limit: limite, offset },
    );
    for (const r of j.rows ?? []) out.push({ dims: r.dimensionValues.map((v) => v.value), mets: r.metricValues.map((v) => Number(v.value) || 0) });
    if (!j.rowCount || offset + limite >= j.rowCount) break;
  }
  return out;
}
