import { NextResponse } from "next/server";
import { HttpError } from "./auth";
import { AuditError } from "./audits";

/** Enveloppe une route API : erreurs → JSON en français, sans détail technique côté client. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ erreur: e.message }, { status: e.status });
      if (e instanceof AuditError) return NextResponse.json({ erreur: e.message, ...(e.data as object) }, { status: e.status });
      if (e instanceof Error && e.name === "ZodError") return NextResponse.json({ erreur: "Données invalides" }, { status: 400 });
      console.error(e);
      const msg = e instanceof Error && /introuvable|déjà traité|Aucun import/.test(e.message) ? e.message : "Erreur inattendue";
      return NextResponse.json({ erreur: msg }, { status: 400 });
    }
  };
}
