import "server-only";
import { randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Mots de passe : scrypt (N = 2^15, r = 8, p = 1), sel aléatoire de 16 octets, stocké sous la forme
 * « scrypt$N$r$p$sel$empreinte » (base64url). Aucune dépendance.
 */
const N = 2 ** 15, R = 8, P = 1, LONGUEUR = 32;
export const MDP_MIN = 12;

const scrypt = (mdp: string, sel: Buffer, n: number, r: number, p: number) =>
  new Promise<Buffer>((ok, ko) => scryptCb(mdp.normalize("NFKC"), sel, LONGUEUR, { N: n, r, p, maxmem: 128 * n * r * 2 } satisfies ScryptOptions, (e, k) => (e ? ko(e) : ok(k))));

export async function hacherMotDePasse(mdp: string): Promise<string> {
  const sel = randomBytes(16);
  const k = await scrypt(mdp, sel, N, R, P);
  return `scrypt$${N}$${R}$${P}$${sel.toString("base64url")}$${k.toString("base64url")}`;
}

/** Vérifie en temps constant ; sans empreinte, calcule quand même un hachage (même durée de réponse). */
export async function verifierMotDePasse(mdp: string, stocke: string | null): Promise<boolean> {
  const parts = stocke?.split("$");
  if (!parts || parts.length !== 6 || parts[0] !== "scrypt") {
    await scrypt(mdp, randomBytes(16), N, R, P);
    return false;
  }
  const [, n, r, p, sel, empreinte] = parts;
  const attendu = Buffer.from(empreinte, "base64url");
  const k = await scrypt(mdp, Buffer.from(sel, "base64url"), Number(n), Number(r), Number(p));
  return k.length === attendu.length && timingSafeEqual(k, attendu);
}

/** Mot de passe provisoire lisible (sans caractères ambigus), ex. « Kp7m-Xq2r-Tz9w-Hn4c » (≈ 90 bits). */
export function genererMotDePasse(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => A[randomInt(A.length)]).join("")).join("-");
}

/** Règles d'un mot de passe choisi : null si valable, sinon le message à afficher. */
export function problemeMotDePasse(mdp: string, email: string): string | null {
  if (mdp.length < MDP_MIN) return `Au moins ${MDP_MIN} caractères.`;
  if (mdp.length > 200) return "200 caractères au plus.";
  const bas = mdp.toLowerCase();
  if (bas.includes(email.toLowerCase().split("@")[0]) && email.split("@")[0].length >= 4) return "Le mot de passe ne doit pas contenir votre identifiant.";
  if (/^(.)\1+$/.test(mdp) || ["motdepasse", "password", "azertyuiop", "123456789012", "speedresa"].some((x) => bas.includes(x))) return "Mot de passe trop facile à deviner.";
  return null;
}
