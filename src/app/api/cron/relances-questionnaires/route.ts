import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { relancerQuestionnaires } from "@/lib/server/questionnaires";

/** Tous les jours (Vercel Cron) : relances des questionnaires sans réponse à J+3 et J+7. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  }
  return NextResponse.json(await relancerQuestionnaires(await getDb()));
}
