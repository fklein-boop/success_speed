import { Resend } from "resend";

export interface Email {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: string | Buffer }[];
  replyTo?: string;
}

/**
 * Envoi d'emails transactionnels via Resend. Sans clé :
 *  - en développement, l'email est affiché dans la console (liens de connexion compris) ;
 *  - en production, l'envoi échoue proprement et rien n'est écrit dans les logs.
 */
export async function sendEmail(e: Email): Promise<{ ok: boolean; erreur?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`\n✉️  [email non envoyé — RESEND_API_KEY absente]\nÀ : ${e.to}\nObjet : ${e.subject}\n${e.text}${e.attachments?.length ? `\nPièces jointes : ${e.attachments.map((a) => a.filename).join(", ")}` : ""}\n`);
      return { ok: true };
    }
    console.error("RESEND_API_KEY absente : email non envoyé");
    return { ok: false, erreur: "Service d'email non configuré" };
  }
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Audit CSM SpeedResa <onboarding@resend.dev>",
    to: e.to,
    subject: e.subject,
    html: e.html,
    text: e.text,
    attachments: e.attachments,
    replyTo: e.replyTo,
  });
  if (error) {
    console.error("Envoi email échoué :", error.name);
    return { ok: false, erreur: error.message };
  }
  return { ok: true };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Gabarit HTML aux couleurs SpeedResa (tables + styles en ligne pour les clients mail). */
export function emailLayout(opts: { titre: string; paragraphes: string[]; bouton?: { label: string; url: string }; pied?: string }) {
  const p = opts.paragraphes.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#000033">${esc(t)}</p>`).join("");
  const b = opts.bouton
    ? `<p style="margin:24px 0"><a href="${esc(opts.bouton.url)}" style="display:inline-block;background:#0A56FC;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">${esc(opts.bouton.label)} →</a></p>`
    : "";
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#E3E7EF;font-family:'Open Sans',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E3E7EF;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#000033;padding:20px 32px;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,sans-serif">speed<span style="color:#00CCCC">resa</span></td></tr>
<tr><td style="height:4px;background:linear-gradient(90deg,#0A56FC,#00CCCC,#1EDDAE)"></td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 20px;font-size:20px;color:#000033">${esc(opts.titre)}</h1>${p}${b}
${opts.pied ? `<p style="margin:24px 0 0;font-size:12px;color:#7B859B">${esc(opts.pied)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}
