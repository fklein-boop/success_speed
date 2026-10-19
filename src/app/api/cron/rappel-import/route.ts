import { and, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { imports, users } from "@/db/schema";
import { appUrl } from "@/lib/server/auth";
import { emailLayout, sendEmail } from "@/lib/server/email";

/** Lundi midi (Vercel Cron) : rappel si aucun import n'a été fait depuis lundi 0 h. */
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erreur: "non autorisé" }, { status: 401 });
  }
  const db = await getDb();
  const lundi = new Date();
  lundi.setUTCHours(0, 0, 0, 0);
  lundi.setUTCDate(lundi.getUTCDate() - ((lundi.getUTCDay() + 6) % 7));
  const faits = await db.select({ id: imports.id }).from(imports)
    .where(and(eq(imports.type, "dossiers"), eq(imports.statut, "applique"), gte(imports.appliqueLe, lundi)));
  if (faits.length) return NextResponse.json({ rappel: false });
  const dest = await db.select({ email: users.email }).from(users)
    .where(and(eq(users.actif, true), inArray(users.role, ["superadmin"])));
  const texte = "L'extract SpeedResa de la semaine n'a pas encore été importé. Les indicateurs et alertes du cockpit ne sont donc pas à jour.";
  await sendEmail({
    to: dest.map((d) => d.email),
    subject: "Rappel : import du lundi à faire",
    text: `${texte}\n\n${appUrl()}/imports`,
    html: emailLayout({ titre: "Import du lundi à faire", paragraphes: [texte], bouton: { label: "Mettre à jour les chiffres", url: `${appUrl()}/imports` } }),
  });
  return NextResponse.json({ rappel: true });
}
