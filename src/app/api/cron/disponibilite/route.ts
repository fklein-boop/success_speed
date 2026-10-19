import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mesurerDisponibilite } from "@/lib/server/disponibilite";

export const maxDuration = 120;

/**
 * Monitoring de disponibilité (TECH-04), à appeler toutes les 15 minutes.
 * Avec le worker, inutile (il mesure lui-même). Sans worker : Vercel Cron (offre Pro,
 * planification « *\/15 * * * * ») ou tout service de planification externe, avec le jeton CRON_SECRET.
 */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await mesurerDisponibilite(await getDb()));
}
