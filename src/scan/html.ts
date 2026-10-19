/** Outils de lecture HTML sans dépendance (le DOM complet n'est pas nécessaire ici). */

const ENTITES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", ccedil: "ç", ocirc: "ô", ucirc: "û", icirc: "î", rsquo: "’", laquo: "«", raquo: "»" };
export function decoder(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return ENTITES[e.toLowerCase()] ?? m;
  });
}

/** Texte visible approximatif d'une page. */
export function texteDe(html: string): string {
  return decoder(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr|section)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export interface Lien { href: string; texte: string }

export function liens(html: string, base: string): Lien[] {
  const out: Lien[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = m[1].match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    try {
      const titre = m[1].match(/title\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
      out.push({ href: new URL(decoder(href), base).toString(), texte: (texteDe(m[2]) || decoder(titre)).trim() });
    } catch { /* lien invalide */ }
  }
  return out;
}

export function metaContent(html: string, name: string): string | null {
  const re = new RegExp(`<meta\\b[^>]*(?:name|property)\\s*=\\s*["']${name}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag?.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] ?? null;
}

/** URL des scripts, iframes et feuilles de style. */
export function ressources(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<(?:script|iframe|link|img)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    try { out.add(new URL(decoder(m[1]), base).toString()); } catch { /* ignore */ }
  }
  return [...out];
}

/** Extrait de texte autour d'une correspondance (pour la preuve). */
export function extraitAutour(texte: string, re: RegExp, rayon = 90): string | null {
  const m = re.exec(texte);
  if (!m) return null;
  const d = Math.max(0, m.index - rayon), f = Math.min(texte.length, m.index + m[0].length + rayon);
  return `${d > 0 ? "…" : ""}${texte.slice(d, f).replace(/\s+/g, " ").trim()}${f < texte.length ? "…" : ""}`;
}

/** URL des scripts, iframes et actions de formulaire (code exécuté ou intégré dans la page). */
export function scriptsEtIframes(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<(?:script|iframe|embed|object)\b[^>]*\b(?:src|data)\s*=\s*["']([^"']+)["']/gi)) {
    try { out.add(new URL(decoder(m[1]), base).toString()); } catch { /* ignore */ }
  }
  for (const m of html.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi)) {
    try { out.add(new URL(decoder(m[1]), base).toString()); } catch { /* ignore */ }
  }
  return [...out];
}
