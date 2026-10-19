import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { traiterFileScans } from "@/lib/server/scans";

export const maxDuration = 300;

/** Tous les jours, sans worker (SCAN_MODE=inline) : traite les scans restés en file (rescan mensuel). */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  }
  if (process.env.SCAN_MODE === "worker") return NextResponse.json({ ignore: "le worker traite la file" });
  return NextResponse.json(await traiterFileScans(await getDb(), 280_000));
}
