/** Formats français : 12/10/2026, 45,8 M€, 12 %. */
const nb = (n: number, d = 0) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/ /g, " ");

export const fmtDate = (iso: string | Date | null | undefined) => {
  if (!iso) return "—";
  const s = typeof iso === "string" ? iso : iso.toISOString();
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

export const fmtDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" }) : "—";

export const fmtEur = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${nb(Math.round(n))} €`);

export function fmtEurCompact(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${nb(n / 1e6, 1)} M€`;
  if (a >= 1e3) return `${nb(n / 1e3, a >= 1e5 ? 0 : 1)} k€`;
  return `${nb(n)} €`;
}

export function fmtPct(x: number | null | undefined, signe = false, d = 0) {
  if (x === null || x === undefined || !isFinite(x)) return "—";
  const s = `${nb(x * 100, d)} %`;
  return signe && x > 0 ? `+${s}` : s;
}

export const fmtNb = (n: number | null | undefined) => (n === null || n === undefined ? "—" : nb(n));

export function joursDepuis(iso: string | null, today = new Date()) {
  if (!iso) return null;
  return Math.floor((today.getTime() - Date.parse(iso + "T00:00:00Z")) / 86_400_000);
}

/** « 2026-10-20T14:30 » saisi en heure de Paris → instant UTC (gère l'heure d'été). */
export function parisVersUtc(local: string): Date {
  const naif = new Date(`${local}:00Z`);
  const enParis = new Date(naif.toLocaleString("en-US", { timeZone: "Europe/Paris" }));
  const enUtc = new Date(naif.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(naif.getTime() - (enParis.getTime() - enUtc.getTime()));
}

/** Date et heure à Paris : « 20/10/2026 à 14:30 ». */
export const fmtDateHeure = (d: Date | string) => {
  const x = new Date(d);
  return `${x.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} à ${x.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}`;
};
