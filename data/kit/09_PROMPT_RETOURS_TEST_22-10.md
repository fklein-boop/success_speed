# Retours du premier test de l'outil — 22/10/2026

> À donner à Claude Code dans le projet `plateforme-audit-csm`. Lis aussi `08_DEMANDES_EQUIPES_EXPORTS.md` (même dossier) : il décrit les nouveaux exports back-office que les équipes vont fournir.

---

## Contexte

Le responsable CS (super admin) a fait un premier audit complet dans l'outil, sur **Saberatours – Miravita** (S30). Ce compte n'a plus de volume depuis mai 2026, et sa fiche Google le dit « définitivement fermé ».

**Ce qui fonctionne et doit être gardé tel quel :**
- le bouton « Compléter l'audit », très naturel ;
- la vue d'ensemble par pilier qui se remplit au fur et à mesure des validations ;
- le score et la couverture en direct.

Le reste de ce document liste les changements demandés, par ordre de priorité. Comme avant :
- avance par lots ;
- tests au vert ;
- note tes choix dans `DECISIONS.md` ;
- **arrête-toi après chaque lot pour une démonstration.**

---

## Lot A — Ne plus jamais demander à la main ce que les données savent déjà

### A1. Critères calculés sur l'export dossiers : toujours automatiques
Pendant le test, PERF-05 (ventes confirmées 90 j vs N-1) et PERF-06 (évolution du volume 90 j) étaient à **remplir à la main**. Cela n'est pas acceptable : toutes les données sont dans l'extract du lundi.
- Trouve pourquoi. Hypothèse probable : le client n'a aucun volume sur la période, et le calcul renvoie « non calculable », ce qui fait retomber le critère dans les questions manuelles.
- **Règle** : un critère de source « Données » n'apparaît jamais dans « Répondre au reste ». Il est toujours rempli automatiquement, en confiance haute, avec une phrase d'explication :
  - volume 0 sur les deux périodes → NON, « Aucune vente sur les 90 derniers jours ni sur la même période l'an dernier » ;
  - volume 0 cette année mais pas l'an dernier → NON ;
  - pas assez d'historique (nouveau client) → N.A., avec l'explication.
- Même règle pour PERF-12, RES-04, RES-05, SOC-07.
- Ajoute un test pour un client sans aucun volume récent (cas S30).

### A2. Conversion du site (PERF-04) calculée automatiquement
Le connecteur GA4 et l'import du trafic existent déjà. **PERF-04 doit se remplir tout seul** dès que le trafic du client est connu :
- calcul : confirmés ÷ visites ;
- une fois la colonne `Origine` disponible (cf. A4), ne compter que les dossiers d'origine « site web ».

Faute de trafic : « non vérifiable — trafic inconnu », avec un lien vers l'écran Google Analytics. Aucune question manuelle.

TRK-01 (GA4 en place) passe aussi à OUI, en confiance haute, si la propriété GA4 commune reçoit des sessions pour ce client.

### A3. Import des nouveaux exports back-office
Étends la **mise à jour du lundi** pour accepter, dans la même zone de dépôt, plusieurs fichiers déposés ensemble :
- export dossiers enrichi ;
- export catalogue ;
- export configuration (ou export connexions) ;
- export PayBox (mensuel).

Le format exact de chacun est dans `08_DEMANDES_EQUIPES_EXPORTS.md`.
- **Reconnaissance du type** de chaque fichier par ses colonnes (pas par son nom). Un seul aperçu récapitule tous les fichiers déposés.
- **Robustesse** : tant que les équipes n'ont pas livré un export, tout continue de fonctionner comme aujourd'hui. Les critères concernés restent manuels, avec la mention « en attente de l'export catalogue » (ou configuration…).
- **Les exports ne sont pas encore produits.** Crée pour chacun un fichier d'exemple fictif dans `tests/fixtures/` et teste l'import dessus. Quand le vrai fichier arrivera, un écran de correspondance des colonnes (déjà prévu pour l'extract dossiers) doit permettre de s'adapter sans recoder.

### A4. Nouveaux critères automatiques grâce à ces exports

| Critère | Source | Règle |
|---|---|---|
| PROD-02 Tarification complète | catalogue | Part des produits internes en ligne avec prix adulte **et** prix enfant (si applicable) ; seuils 90 % / 60 % |
| PROD-05 Stocks | catalogue | Part des produits avec `Stock géré = oui` ; seuils 50 % / 20 % |
| PROD-06 Options | catalogue | Part des produits avec `Nb options` ≥ 1 (seuils existants) |
| PROD-07 Assurances | configuration + catalogue | `Module assurance actif = oui` et ≥ 50 % des produits avec assurance associée |
| PROD-08 Fraîcheur | catalogue | Part des produits en ligne mis à jour depuis moins de 90 j (seuils existants) |
| PERF-03 Disponibilité | catalogue | Part des produits internes en ligne avec `Départs futurs ouverts` ≥ 1 (seuils existants) |
| PERF-07 Abandon panier | dossiers (`Email renseigné`) ou GA4 | Selon la réponse de Martin (cf. 08) : rends la source paramétrable |
| PERF-08 Upsell & assurances | dossiers | (`Montant options` + `Montant assurance`) ÷ `Total du dossier`, sur les dossiers confirmés de 12 mois |
| RES-01 Comptes B2B | configuration | ≥ 1 compte autonome, si le modèle du client est B2B/CSE, sinon N.A. |
| RES-02 / RES-03 Réseau S01 | catalogue | Part de produits partagés sur S01 / part de produits de source « réseau S01 ». Seuils à proposer. |
| SOC-01 Connecteurs | configuration | Au moins un CRM/ERP dans `Connecteurs` avec un échange de moins de 7 jours |
| SOC-02 KIT | configuration | `Date mise à jour KIT` de moins de 12 mois |
| SOC-03 Paiement | configuration | `Paiement en ligne actif = oui` |
| SOC-04 PayBox | PayBox + dossiers | Rapprochement par `IDresa` ; OUI si ≥ 98 % des dossiers payés en ligne ont leur transaction. L'écran liste les écarts. |
| SOC-06 Scylla | configuration | `Migration Scylla = oui` **et** `Scylla vérifié = oui` |
| SOC-08 Back-office | configuration / connexions | Au moins 4 semaines sur 4 avec une connexion, ou au moins 4 connexions sur 30 j |
| LEG-12 3-D Secure | configuration | `3-D Secure actif` |
| DIST-01 Veepee | configuration | `Opt-in Veepee` |
| PERF-13 Relance | configuration | `Relance panier active` |
| PERF-02 Flux TO | configuration | `Filtres flux TO actifs = oui` → proposition OUI en confiance moyenne, à confirmer par le CSM |

**Nouvelles alertes** :
- **échéance de contrat dans moins de 90 jours sans RDV planifié** → rouge ;
- **aucune connexion au back-office depuis 30 jours** → rouge.

Ces deux alertes étaient déjà prévues dans les règles de calcul (§ 4).

### A5. Fiche Google fermée = alerte rouge
L'API Places renvoie `businessStatus` (`CLOSED_PERMANENTLY`, `CLOSED_TEMPORARILY`). Enregistre ce statut :
- « fermé définitivement » → **alerte rouge de départ** et bandeau sur la fiche client ;
- « fermé temporairement » → orange.

### A6. Pourquoi VIS-02 et VIS-03 n'ont rien trouvé
1. **Vérifie, et affiche dans le résultat**, la cause exacte. Hypothèse : `GOOGLE_PLACES_API_KEY` n'est pas renseignée en production. Dans ce cas, le résultat doit dire « Clé Google Places manquante — à renseigner dans Administration », et non un « non vérifiable » muet.
2. Ajoute dans Administration un écran **« État des services »** : pour chaque clé (Places, PageSpeed, Anthropic, Resend, GA4) et pour le worker de scan, afficher configuré / non configuré, le dernier appel réussi et les critères qui en dépendent.
3. **VIS-03** reste manuel, car l'API ne donne pas les réponses du propriétaire. La carte affiche :
   - le lien direct vers les avis de la fiche ;
   - la note et le nombre d'avis déjà trouvés ;
   - la consigne : « Ouvrez les 10 derniers avis : combien ont une réponse de l'agence ? ».

   Le CSM saisit le nombre, et le statut se calcule avec les seuils.

---

## Lot B — Rendre la complétion encore plus claire

### B1. « Valider l'automatique » : expliquer le but et l'effet
Ajoute en tête de l'étape A une phrase courte, par exemple :
> « Le scan a vérifié le site de [client]. Ces résultats ne comptent dans le score qu'une fois validés par vous. Validez ceux qui sont justes ; corrigez les autres : votre réponse remplace celle du scan, et elle est gardée pour le prochain audit. »

Et rends visible :
- **ce qui se passe après la validation** : le score et la vue par pilier bougent (montre-le avec une courte animation sur le pilier concerné) ;
- **comment corriger un résultat**, avant ou après validation : sur chaque ligne, un bouton « Corriger » ouvre la carte du critère avec la preuve. Un résultat validé reste modifiable jusqu'à la finalisation ; on voit « validé par X le JJ/MM ».

### B2. Choisir qui répond : le CSM ou le client
Dès l'étape « Répondre au reste », et sans attendre la fin, le CSM doit pouvoir **générer le lien du questionnaire client**. Ajoute un panneau « Répartir les questions » :
- liste des critères restants, chacun avec un sélecteur **CSM / Client** ;
- **répartition par défaut** :

| Par défaut | Critères |
|---|---|
| **Client** | VIS-05 (après une première vérification CSM, cf. B3), VIS-06, PROD-01, LEG-09 (taille de l'entreprise), LEG-10, LEG-11, TRK-05 (publicité en ligne), INN-03 |
| **CSM** | PERF-02, PERF-09, DIST-02, INN-04, VIS-04, VIS-03 |
| **CSM puis client** si le CSM ne sait pas | PROD-02, PROD-05, PROD-06, PROD-07 (tant que l'export catalogue n'est pas là) |

- un bouton « Générer le lien client » avec les questions sélectionnées (copier le lien ou l'envoyer par email) ;
- le CSM continue pendant ce temps avec ses propres questions. Les réponses du client arrivent dans l'audit et apparaissent dans « À valider ».

### B3. Une méthode de vérification guidée pour chaque critère manuel
Le CSM ne doit jamais se demander « comment je vérifie ça ? ». Pour chaque critère manuel, la carte affiche un bloc **« Comment vérifier »** en 2 à 4 étapes concrètes, avec des liens qui s'ouvrent directement. Rédige-les toutes, puis fais-les valider. En voici trois à reprendre :

- **VIS-04 Relais de l'URL sur des sites partenaires, mairies, CSE** — ne pas se contenter du déclaratif client.
  - **Automatique** : lance une recherche web via Claude avec l'outil de recherche, comme pour INN-01. Requêtes du type `"<domaine>" -site:<domaine>`, `"<nom de l'agence>" mairie`, `"<nom de l'agence>" CSE`, `"<nom de l'agence>" office de tourisme`.
  - Présente au CSM la liste des pages trouvées qui citent ou lient le site, avec leur type deviné (mairie, CSE, office de tourisme, presse, annuaire…). Il coche celles qui sont de vrais relais : ≥ 2 relais locaux = OUI, 1 = PARTIELLEMENT.
  - Mentionne dans `DECISIONS.md` l'option payante plus complète (API de liens entrants type Ahrefs, Semrush ou Majestic) et son coût, pour décision.
- **VIS-05 « Au moins 2 publications d'offres avec lien direct par semaine »** — définition à afficher :
  - « Une publication sur Facebook, Instagram ou LinkedIn qui présente une offre précise (un voyage, un séjour) et dont le lien mène directement à la fiche de ce voyage sur le site de l'agence, pas à la page d'accueil. »
  - **Vérification** : l'outil ouvre les pages sociales trouvées par le scan (VIS-01). Le CSM compte les publications de ce type sur les 4 dernières semaines : ≥ 8 = OUI, 4 à 7 = PARTIELLEMENT, < 4 = NON.
  - Si les réseaux ne sont pas trouvés ou sont privés → question au client.
- **LEG-10 Facturation électronique** — explication en langage simple pour le CSM et le client :
  - quoi : à partir du 1er septembre 2026, toutes les entreprises doivent pouvoir **recevoir** des factures électroniques ; les PME devront les **émettre** au 1er septembre 2027 ;
  - quoi faire : choisir une plateforme agréée par l'administration ;
  - question au client : « Avez-vous choisi votre plateforme ? ».

  Ajoute dans `config/offres.json` une piste d'offre « accompagnement facturation électronique », effort à définir.

### B4. Une page d'audit qui reprend tout après le passage du CSM
Une fois les deux étapes faites, la page de l'audit doit présenter, dans cet ordre :
1. la maturité (avec le niveau) ;
2. le taux de couverture ;
3. les points restant à valider (dont les réponses du client) ;
4. les dernières questions sans réponse, avec qui doit y répondre ;
5. le bouton **« Vue d'ensemble par pilier »**.

### B5. Mode présentation client
La vue d'ensemble par pilier doit pouvoir être **montrée au client pendant le rendez-vous** :
- bouton « Présenter au client » : plein écran, aux couleurs SpeedResa, gros caractères ;
- **aucune donnée interne** : pas de score santé, d'alertes de départ, de chiffres de vente ni de commentaires ;
- navigation pilier par pilier (flèches du clavier), avec pour chacun ce qui est en place, ce qui manque et la solution proposée ;
- sortie par Échap.

Réutilise le « modèle client » qui sert déjà au PDF.

### B6. Accueil : trouver un client plus vite
Sur l'accueil, la liste des clients est sous le graphique : il faut descendre pour la trouver. Ajoute :
- un **champ « Rechercher un client »** tout en haut de l'accueil, avec raccourci `/` et accès direct à la fiche ;
- un lien « Mes clients » qui fait défiler jusqu'à la liste.

---

## Lot C — Une restitution qui donne envie d'agir

### C1. Remplacer le CSV brut par une feuille de route
En cliquant sur « Finaliser l'audit » puis « Version client », on obtient aujourd'hui un CSV brut, peu parlant. Le livrable client devient **double** :
1. **La feuille de route** (livrable principal, PDF et page de présentation) :
   - **Synthèse rédigée par Claude** : 5 à 8 lignes qui expliquent la situation et les **grands chantiers**.
   - **Chantiers**, et non critères : regroupe les critères à NON ou PARTIELLEMENT en 3 à 6 chantiers cohérents. Exemples : « Mettre le site en conformité légale », « Rendre le catalogue plus attractif », « Mesurer ses ventes en ligne », « Développer les ventes additionnelles ».
   - Chaque chantier comporte :
     - objectif et bénéfice attendu pour le client ;
     - critères concernés ;
     - **priorité** (haute / moyenne / basse) et **ordre** dans le temps ;
     - échéance proposée (ex. « d'ici 30 jours », « T1 2027 ») ;
     - **porteur**, à choisir parmi : CSM Speedmedia, une équipe Speedmedia (liste paramétrable dans l'administration, ex. équipe technique, équipe « M3M » — nom à confirmer), un prestataire tiers, le client lui-même ;
     - solution ou offre Speedmedia associée.
   - Une **frise ou un tableau de feuille de route** sur 3 à 6 mois.
2. **Le CSV détaillé** (existant) en annexe, pour qui veut le détail critère par critère.

### C2. La feuille de route se construit avec le CSM
- Claude propose les chantiers, la priorisation et les porteurs, à partir du plan d'action, des impacts et efforts, et des leviers de performance.
- Le CSM ajuste avant envoi, idéalement **avec le client pendant le rendez-vous** :
  - glisser-déposer pour réordonner ;
  - changer le porteur ou l'échéance ;
  - fusionner ou scinder des chantiers ;
  - retirer un critère.
- Une fois validée, elle est enregistrée sur la fiche client. Chaque chantier devient un suivi (proposé / accepté / en cours / fait), relié aux actions existantes. Le PDF et l'email reprennent la version validée.
- **Sans clé Anthropic**, un regroupement par règles (par pilier et levier) prend le relais. Mais la synthèse rédigée est l'intérêt principal : vérifie que la clé est bien utilisée en production.

---

## Lot D — Nettoyage du référentiel de critères

À appliquer dans le référentiel (avec versionnement, comme prévu dans l'administration) :
- **Supprimer** REL-01 (RDV avec le CSM depuis moins de 90 jours) et REL-02 (NPS) : nos clients n'ont pas de score de satisfaction.
- **Supprimer** SOC-05 (MT / SRA2) : plus aucun client sur SRA2.
- **REL-03** (interlocuteur digital) : le retirer du score et en faire un simple champ d'information sur la fiche client.
- Après suppression, le pilier « Relation client » est vide : le retirer.
- Les audits existants restent lisibles. Recalcule leurs scores sur le référentiel actif et indique-le dans l'historique.

---

## Lot E — Rapport de vérifiabilité sur tout le portefeuille

Le super admin veut savoir quels critères automatiques sont **réellement vérifiables** au-delà d'un seul client. Les critères concernés sont notamment VIS-08, PROD-03, PROD-04, PROD-09, LEG-07, PERF-01, et tous les critères Auto en général.
- Lance un pré-audit (sans enregistrer d'audit) sur **les 66 sites** du référentiel, avec le worker navigateur.
- Produis un écran « Fiabilité des contrôles » dans l'administration, et un CSV : pour chaque critère, la répartition OUI / PARTIEL / NON / non vérifiable / N.A. et la confiance moyenne.
- **Repère les critères « plateforme »** : ceux dont le résultat est identique sur tous les sites SpeedResa. C'est probablement le cas de VIS-08 (données structurées des fiches), sans doute de PERF-01 et d'une partie de PROD-03, car ces éléments sont produits par les gabarits SpeedResa, pas par le client.
  - Pour ces critères, propose de les marquer « Plateforme » : ils ne pénalisent plus le client, car ce n'est pas de son ressort.
  - Ils alimentent une liste de **chantiers produit pour Speedmedia**, avec le nombre de clients concernés.
- Donne pour chaque critère non vérifiable la cause principale : clé manquante, site sans navigateur, tunnel désactivé, page introuvable, etc.

---

## Ce qu'il faut me rendre à la fin de chaque lot
- Démo sur Saberatours (S30) et sur un client actif avec du volume (par ex. PERIER Voyages, P17).
- Ce qui a changé pour le CSM, en 5 lignes maximum.
- Le temps mesuré d'un audit complet avant et après.
- Les points qui attendent les équipes : exports, clés d'API, réponses de Martin et de Mathieu.
