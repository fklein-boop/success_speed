import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { planifierRescanMensuel, traiterFileScans } from "@/lib/server/scans";

export const maxDuration = 300;

/** Le 1er du mois (Vercel Cron) : rescan léger de tous les clients. Sans worker, une première partie est traitée tout de suite. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  }
  const db = await getDb();
  const plan = await planifierRescanMensuel(db);
  const exec = process.env.SCAN_MODE === "worker" ? null : await traiterFileScans(db, 280_000);
  return NextResponse.json({ ...plan, execution: exec });
}
