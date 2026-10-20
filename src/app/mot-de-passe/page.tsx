import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { MDP_MIN } from "@/lib/server/mots-de-passe";
import { Logo } from "@/components/Logo";
import { FormChoixMotDePasse } from "./Form";

/** Choix du mot de passe : obligatoire après un mot de passe provisoire, possible à tout moment ensuite. */
export default async function MotDePassePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/connexion");
  const provisoire = user.motDePasseTemporaire;
  return (
    <main className="flex min-h-screen items-center justify-center bg-minuit px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center"><Logo inverse className="text-3xl" /></div>
        <div className="carte p-8">
          <h1 className="text-2xl">{provisoire ? "Choisissez votre mot de passe" : user.motDePasseHash ? "Changer mon mot de passe" : "Créer mon mot de passe"}</h1>
          <p className="mt-2 text-sm text-gris-texte">
            {provisoire ? "Le mot de passe fourni par votre administrateur est provisoire. Remplacez-le par un mot de passe personnel pour accéder à la plateforme." : "Votre identifiant reste votre adresse email."}
            {" "}Au moins {MDP_MIN} caractères ; une phrase de plusieurs mots est idéale.
          </p>
          <p className="mt-2 text-sm">Identifiant : <strong>{user.email}</strong></p>
          <FormChoixMotDePasse demanderActuel={!!user.motDePasseHash} provisoire={provisoire} />
          {!provisoire && <Link href="/" className="mt-4 inline-block text-sm text-horizon hover:underline">Retour à la plateforme</Link>}
        </div>
      </div>
    </main>
  );
}
