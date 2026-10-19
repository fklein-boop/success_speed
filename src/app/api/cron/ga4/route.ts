import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { ga4Configure } from "@/lib/ga4/client";
import { configGa4, synchroniserGa4 } from "@/lib/server/ga4";

export const maxDuration = 300;

/** Le 2 du mois (Vercel Cron) : relevé Google Analytics 4 des 13 derniers mois complets. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  }
  const db = await getDb();
  const c = await configGa4(db);
  if (!ga4Configure() || !c.propertyId || !c.dimension) return NextResponse.json({ ignore: "Google Analytics non configuré" });
  try {
    const etat = await synchroniserGa4(db, null);
    return NextResponse.json({ clients: etat.clients, mois: etat.mois.length, enAttente: etat.enAttente.length });
  } catch (e) {
    return NextResponse.json({ erreur: e instanceof Error ? e.message : "échec" }, { status: 500 });
  }
}
