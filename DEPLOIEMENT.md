# Mise en ligne — guide pas à pas

Légende : **👤 Vous** = ce que vous seul pouvez faire (comptes, paiements, mots de passe, DNS). **🤖 Claude** = ce que je peux faire depuis ce Mac, avec votre accord.

Durée totale : environ 1 h 30, dont une bonne partie à attendre la vérification DNS de Resend.

## État de préparation (vérifié le 19/10/2026)

- ✅ Build de production réussi, 215 tests au vert, typage sans erreur.
- ✅ Installation sur base vide simulée : 7 migrations, 77 critères, 83 clients, 2 anciens audits.
- ✅ Aucun secret dans les fichiers du projet. `.env.local`, les données locales, les tests et le worker ne sont pas envoyés à Vercel (`.vercelignore`) : environ 2 Mo envoyés.
- ✅ Tâches planifiées déclarées dans `vercel.json` (région Frankfurt), toutes au plus une fois par jour.
- ⏳ Reste à faire de votre côté : étapes 1 à 5 ci-dessous (comptes, secrets, variables). Ensuite, dites « déploie ».

**Le plus court chemin pour tester sur Vercel** : étapes 1, 2, 3, 5 (avec `EMAIL_FROM="Audit CSM <onboarding@resend.dev>"` et une clé Resend créée avec l'adresse du super admin), puis 6. Le worker (étape 8) et les clés d'API (étape 9) peuvent venir après.

---

## 0. Avant de commencer (👤 Vous, décisions)

- **Offre Vercel Pro** (environ 20 $ par mois et par membre) : l'offre gratuite Hobby est **réservée à un usage non commercial**. Pro permet aussi aux traitements longs (import du lundi, scans) de dépasser 60 secondes.
- **Compte Fly.io** pour le worker de scan (navigateur, captures, monitoring toutes les 15 min) : environ 5 à 7 $ par mois pour une machine `shared-cpu-1x` de 1 Go à Paris. Sans worker, l'application fonctionne, mais le pré-audit tourne sans navigateur (mode dégradé) et la disponibilité des sites n'est pas mesurée.
- **L'adresse du super admin** (votre adresse Speedmedia).
- **Un accès aux DNS** du domaine d'envoi des emails (ex. `speedmedia.fr`), ou une personne qui l'a.

> Les données locales (imports, audits de test faits sur ce Mac) **ne sont pas transférées**. La production démarre avec le référentiel (77 critères, 83 clients) et les 2 audits de l'ancienne grille ; vous y importerez l'extract du lundi.

---

## 1. Générer les deux secrets (👤 Vous, terminal)

Lancez cette commande deux fois et gardez les deux résultats sous la main, sans les envoyer par email ni par chat :

```bash
openssl rand -base64 32
```

- le premier sera `AUTH_SECRET` (signe les sessions et les liens des questionnaires) ;
- le second sera `CRON_SECRET` (protège les tâches planifiées).

---

## 2. Créer le projet Vercel

1. **👤 Vous** : créez un compte sur [vercel.com](https://vercel.com) (ou utilisez celui de Speedmedia) et passez l'équipe en **Pro**.
2. **👤 Vous** : connectez la ligne de commande Vercel à votre compte (un navigateur s'ouvre pour valider) :

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && PATH=$HOME/.local/node/bin:$PATH npx vercel login
```

3. **👤 Vous** : créez et liez le projet. Répondez : bonne équipe (*scope*), **Link to existing project? → No**, nom `audit-csm`, dossier `./`, ne modifiez pas les réglages détectés (Next.js) :

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && PATH=$HOME/.local/node/bin:$PATH npx vercel link
```

La région **Frankfurt (fra1)** est imposée par `vercel.json`.

## 3. Créer la base Neon (👤 Vous, tableau de bord Vercel)

Projet `audit-csm` → **Storage** → **Create Database** → **Neon** → région **Frankfurt (AWS eu-central-1)** → offre gratuite pour commencer → **Connect** au projet, environnements *Production*, *Preview* et *Development*.

Vercel ajoute la variable `DATABASE_URL`. Au premier déploiement, les tables sont créées et le référentiel est chargé automatiquement.

> L'offre gratuite de Neon (0,5 Go) suffit pour démarrer. Les captures d'écran des scans (environ 25 Mo par mois avec le worker) la rempliront en un an environ : passez à l'offre *Launch* le moment venu, ou demandez-moi une purge automatique des anciennes captures.

## 4. Configurer Resend pour les emails (👤 Vous)

1. Créez un compte sur [resend.com](https://resend.com), de préférence **avec l'adresse du super admin**.
2. **Domains → Add domain** : `speedmedia.fr` (ou un sous-domaine, ex. `audit.speedmedia.fr`), région **EU (Ireland)**. Publiez les enregistrements DNS indiqués (SPF, DKIM), puis attendez le statut *Verified* (de quelques minutes à quelques heures).
3. **API Keys → Create API Key**, droit *Sending access*. Copiez la clé.

> En attendant la vérification du domaine, vous pouvez mettre `EMAIL_FROM="Audit CSM <onboarding@resend.dev>"`. Resend n'envoie alors **qu'à l'adresse du compte Resend**, ce qui suffit pour la première connexion du super admin.

## 5. Renseigner les variables (👤 Vous, tableau de bord Vercel)

Projet → **Settings → Environment Variables**, environnement **Production** :

| Variable | Valeur | Obligatoire |
|---|---|---|
| `SUPERADMIN_EMAIL` | votre adresse Speedmedia | oui |
| `AUTH_SECRET` | premier secret de l'étape 1 | oui |
| `CRON_SECRET` | second secret de l'étape 1 | oui |
| `APP_URL` | l'adresse de production, ex. `https://audit-csm.vercel.app` (corrigez-la après le premier déploiement si besoin) | oui |
| `RESEND_API_KEY` | clé Resend | oui |
| `EMAIL_FROM` | `Audit CSM SpeedResa <audit@speedmedia.fr>` | oui |
| `SCAN_NAVIGATEUR` | `non` (pas de navigateur sur Vercel) | oui |
| `SCAN_CONTACT_URL` | page présentant le robot, ex. `https://www.speedmedia.fr` | conseillé |
| `GOOGLE_PAGESPEED_API_KEY` | voir étape 9 | conseillé |
| `GOOGLE_PLACES_API_KEY` | voir étape 9 | conseillé |
| `ANTHROPIC_API_KEY` | voir étape 9 | conseillé |
| `GA4_CREDENTIALS` | contenu du fichier JSON du compte de service, voir étape 9 (cochez *Sensitive*) | conseillé |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | SSO Google, voir étape 9 | facultatif |
| `TEST_LOGIN_EMAIL` / `TEST_LOGIN_PASSWORD` | compte de test : connexion par email et mot de passe (16 caractères au moins), sans lien magique. Supprimez-les pour le désactiver | facultatif |
| `TEST_LOGIN_ROLE` | rôle du compte de test : `superadmin` (par défaut), `csm` ou `lecture` | facultatif |

`DATABASE_URL` est déjà là (étape 3). Laissez `SCAN_MODE` vide pour l'instant.

**Astuce : tout coller d'un coup.** Sur la page *Environment Variables*, vous pouvez coller plusieurs lignes `NOM=valeur` dans le champ *Key* : Vercel les sépare tout seul. Remplissez ce modèle dans un éditeur de texte (pas dans un fichier du projet), collez-le, puis effacez le brouillon :

```
SUPERADMIN_EMAIL=prenom.nom@speedmedia.fr
AUTH_SECRET=<premier secret>
CRON_SECRET=<second secret>
APP_URL=https://audit-csm.vercel.app
RESEND_API_KEY=<clé Resend>
EMAIL_FROM="Audit CSM SpeedResa <audit@speedmedia.fr>"
SCAN_NAVIGATEUR=non
SCAN_CONTACT_URL=https://www.speedmedia.fr
```

Ajoutez `GA4_CREDENTIALS` à part (valeur sur plusieurs lignes : collez tout le contenu du fichier JSON tel quel, accolades comprises) et cochez *Sensitive* pour les secrets.

## 6. Premier déploiement (🤖 Claude ou 👤 Vous)

Dites-moi « déploie » et je lance la commande ci-dessous, puis je vérifie le journal de build. Vous pouvez aussi la lancer vous-même :

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && PATH=$HOME/.local/node/bin:$PATH npx vercel deploy --prod
```

Le build applique les 7 migrations, charge les critères, les clients et les 2 anciens audits, puis compile l'application (3 à 5 minutes).

**🤖 Claude** vérifie ensuite :
- la page de connexion ;
- l'en-tête de sécurité ;
- le refus des tâches planifiées sans secret ;
- l'absence d'erreur dans les journaux.

## 7. Premier lancement (👤 Vous)

1. Ouvrez l'URL, saisissez l'adresse `SUPERADMIN_EMAIL` et cliquez sur le lien reçu par email.
2. Glissez-déposez l'extract du lundi sur le cockpit, puis cliquez sur « Valider ».
3. **Trafic** : si `GA4_CREDENTIALS` est en place, **Administration → Google Analytics** → « Vérifier les rattachements » → « Valider et synchroniser » (voir étape 9). Sinon, **Imports → Trafic mensuel des sites** avec l'onglet « 4. Métriques GTM » du fichier Excel.
4. **Utilisateurs** : ajoutez les CSM et envoyez les invitations. **Fiches clients** : attribuez les CSM (ou réattribution en masse).
5. **Administration → Empreintes TECH-06** : à faire valider par l'équipe technique.

## 8. Déployer le worker sur Fly.io

1. **👤 Vous** : créez un compte sur [fly.io](https://fly.io), ajoutez un moyen de paiement, puis installez la ligne de commande :

```bash
curl -L https://fly.io/install.sh | sh
```

2. **👤 Vous** : connectez-vous (un navigateur s'ouvre) :

```bash
~/.fly/bin/flyctl auth login
```

3. **👤 Vous** : créez l'application. Si ce nom est pris, choisissez-en un autre et dites-le-moi : j'adapterai `fly.worker.toml`.

```bash
~/.fly/bin/flyctl apps create speedresa-audit-worker
```

4. **👤 Vous** : donnez-lui ses secrets. Utilisez la même `DATABASE_URL` que Vercel (Vercel → Storage → Neon → `.env.local` → `DATABASE_URL`) et les mêmes clés d'API (laissez de côté celles que vous n'avez pas) :

```bash
~/.fly/bin/flyctl secrets set --app speedresa-audit-worker DATABASE_URL="postgresql://…" SCAN_CONTACT_URL="https://www.speedmedia.fr" GOOGLE_PAGESPEED_API_KEY="…" GOOGLE_PLACES_API_KEY="…" ANTHROPIC_API_KEY="…"
```

5. **🤖 Claude ou 👤 Vous** : déployez (l'image Playwright est lourde, comptez 5 à 10 minutes la première fois) :

```bash
cd "/Users/francoisklein/DOSSIERS CLAUDE/AUDIT CSM/plateforme-audit-csm" && ~/.fly/bin/flyctl deploy --config fly.worker.toml --remote-only --ha=false
```

6. **👤 Vous** : sur Vercel, ajoutez `SCAN_MODE` = `worker`. **🤖 Claude** redéploie l'application (étape 6) et vérifie dans les journaux du worker qu'il démarre (« navigateur : oui »), puis la première mesure de disponibilité.

> Ne mettez **pas** `SCAN_TUNNEL=oui` : le parcours du tunnel attend l'essai supervisé décrit dans DECISIONS.md (étape 4).

## 9. Clés d'API (👤 Vous, quand vous voulez)

- **Google PageSpeed** et **Google Places** : [console.cloud.google.com](https://console.cloud.google.com) → créer un projet → activer *PageSpeed Insights API* et *Places API (New)* → **Identifiants → Créer une clé API**. Restreignez la clé à ces deux API. Places est payante au-delà du crédit mensuel gratuit, mais l'usage prévu (une recherche par pré-audit) reste très en dessous.
- **Anthropic** : [console.anthropic.com](https://console.anthropic.com) → **API Keys**. Fixez une limite de dépense mensuelle dans *Limits*.
- **SSO Google** (facultatif) : même console → **Identifiants → ID client OAuth → Application Web**, URI de redirection `https://<votre-url>/api/auth/google/callback`.

- **Google Analytics 4** (trafic, conversion web, abandon panier) — propriété consolidée, paramètre « Nom du client » :
  1. [console.cloud.google.com](https://console.cloud.google.com), projet **audit-speedresa** → **API et services → Bibliothèque** : activez *Google Analytics Data API* et *Google Analytics Admin API*.
  2. **IAM → Comptes de service → audit-csm@audit-speedresa.iam.gserviceaccount.com → Clés → Ajouter une clé → JSON**. Le fichier se télécharge : **ne l'envoyez à personne** (ni par email, ni dans la conversation avec Claude), rangez-le hors du dossier du projet.
  3. Google Analytics → **Administration → Gestion des accès à la propriété** (la propriété qui réunit tous les sites) → ajoutez `audit-csm@audit-speedresa.iam.gserviceaccount.com` avec le rôle **Lecteur**.
  4. Vérifiez dans **Administration → Définitions personnalisées** que « Nom du client » existe en *dimension personnalisée*, portée **Événement**. Sinon créez-la (paramètre d'événement tel qu'envoyé par GTM) : GA4 ne la remplit qu'à partir de sa création.
  5. Vercel → variable `GA4_CREDENTIALS` = tout le contenu du fichier JSON (cochez *Sensitive*). En local : dans `.env.local`, `GA4_CREDENTIALS_FILE=/chemin/vers/le-fichier.json`.
  6. Dans l'outil : **Administration → Google Analytics** → vérifiez la propriété et la dimension (détectées automatiquement), **Vérifier les rattachements**, puis **Valider et synchroniser**. Ensuite, relevé automatique le 2 de chaque mois.

Ajoutez chaque clé sur Vercel (et sur Fly.io pour les clés de scan), puis redéployez.

## 10. Plus tard

- **GitHub** : pour déployer à chaque modification, installez les outils Apple (`xcode-select --install`), créez un dépôt privé et reliez-le au projet Vercel. Je pourrai alors faire les commits.
- **Nom de domaine** (ex. `audit.speedmedia.fr`) : Vercel → Settings → Domains, puis mettez `APP_URL` à jour.
