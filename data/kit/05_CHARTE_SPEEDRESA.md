# Charte graphique SpeedResa — traduction en design tokens

Ces tokens sont extraits de `06_Presentation-speedresa-groupe.pdf`. Le PDF fait foi : en cas de doute (logo, zones de protection, iconographie, photos), c'est lui qu'il faut regarder.

## Esprit
Simplicité et lisibilité : « aucun artifice, aucun élément superflu ». Une société technologique au service du tourisme, perçue comme un partenaire accessible et chaleureux, pas froid. Ne pas ajouter d'effets décoratifs (ombres lourdes, dégradés partout, animations gratuites).

## Couleurs

| Token | Nom | Hex | Usage |
|---|---|---|---|
| `--sr-minuit` | Minuit | `#000033` | Texte principal, logo, fonds sombres (en-tête, pied de page). **Le logo n'est jamais en noir pur.** |
| `--sr-horizon` | Bleu Horizon | `#0A56FC` | Couleur principale : boutons primaires, liens, éléments actifs, série principale des graphiques |
| `--sr-lagon` | Lagon | `#00CCCC` | Couleur secondaire, accents, deuxième série de graphique |
| `--sr-emeraude` | Émeraude | `#1EDDAE` | Accent, succès doux, troisième série |
| `--sr-gris-clair` | Gris clair | `#E3E7EF` | Fonds de cartes, séparateurs, champs |
| `--sr-gris-fonce` | Gris foncé | `#7B859B` | Texte secondaire, libellés, axes |
| `--sr-degrade` | Dégradé | `linear-gradient(90deg, #0A56FC, #00CCCC, #1EDDAE)` | Avec parcimonie : barre de progression d'audit, bandeau de la restitution PDF |

### Contrastes (indiqués dans la charte) — à respecter pour le niveau WCAG AA
- Sur fond blanc :
  - Minuit = 20,04 ✅
  - Horizon = 5,60 ✅
  - Lagon = 2 ❌ — **jamais pour du texte**
  - Émeraude = 1,75 ❌ — **jamais pour du texte**
- Sur fond Minuit :
  - Horizon = 3,75 (grands textes uniquement)
  - Lagon = 10,51 ✅
  - Émeraude = 12,01 ✅
- Lagon et Émeraude servent donc aux aplats, icônes, graphiques et badges avec texte Minuit, et au texte sur fond sombre.

### Couleurs de statut (complément à la charte, à valider)
La charte ne prévoit ni rouge ni orange. Pour les alertes et les statuts d'audit, ajouter des teintes sobres qui s'accordent avec la palette, toujours accompagnées d'une icône ou d'un libellé :
- OUI / Sain : Émeraude (aplat) avec texte Minuit
- PARTIELLEMENT / À surveiller : ambre `#F5A524` (aplat) avec texte Minuit
- NON / Critique : rouge `#E5484D` — en texte sur blanc, utiliser `#C62F35` pour atteindre le contraste AA
- CORRIGÉ : Horizon
- N.A. : Gris foncé

## Typographies
- **Titres : Silka.** C'est une police commerciale : demander les fichiers de police et la licence web à l'équipe marketing, puis les auto-héberger. En attendant, utiliser une police de repli sans empattement, ronde et proche (par ex. *Poppins* ou *Outfit*, auto-hébergées), configurée dans un seul token pour basculer facilement.
- **Textes : Open Sans** (libre, auto-hébergée, pas d'appel à Google Fonts depuis l'app pour des raisons RGPD).
- Hiérarchie : titres en Silka gras, couleur Minuit. Le mot « resa » du logo est en Horizon : on peut reprendre ce jeu bicolore avec parcimonie dans les grands titres.

## Composants
- **Boutons** :
  - primaire : pilule pleine Horizon, texte blanc, icône flèche à droite (« Demander une démo → ») ;
  - secondaire : pilule contour Horizon, texte Horizon ;
  - variantes inversées sur fond Minuit (pilule blanche).
- **Cartes** : fond blanc ou Gris clair, coins arrondis (≈ 12 px), ombre très légère ou bordure Gris clair.
- **UI** : les exemples de la charte montrent des statistiques en grands chiffres, des courbes fines Horizon, des pastilles et des interrupteurs Horizon, des pictogrammes au trait fin Horizon.
- **Icônes** : style trait fin, monochrome Horizon (cf. section « Icône » du PDF). Une bibliothèque comme Lucide s'en rapproche.
- **Photos** : voyage, réalistes et lumineuses. À utiliser seulement dans le questionnaire client et la restitution PDF, pas dans les écrans de travail.
- **Logo** : versions principale, monochrome, blanche, sur fond foncé et icône seule. Respecter la zone de protection. Récupérer les fichiers vectoriels auprès du marketing : ne pas les redessiner. L'icône (pin + flèche) sert de favicon.

## Où appliquer
Partout : application interne, questionnaire client, restitution PDF, emails, exports CSV (nom de fichier et en-tête), et futur auto-audit public.
