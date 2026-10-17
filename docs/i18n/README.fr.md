# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · [Español](README.es.md) · [العربية](README.ar.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [한국어](README.ko.md) · [Tiếng Việt](README.vi.md)

Ajoutez des cellules fusionnées, plusieurs lignes d’en-têtes, des en-têtes de lignes et des tableaux sans en-tête à vos tableaux Markdown. Afficher une table ne réécrit jamais le Markdown de la note.

## Captures d’écran

### Tableau à trois lignes en mode lecture

Les en-têtes groupés et les cellules fusionnées restent visibles sans encadrer chaque cellule.

![Structural Tables Reading View](../assets/structural-tables-reading-view-en.png)

### Modification dans l’aperçu en direct

Cliquez une cellule sur ordinateur, ou appuyez deux fois sur un écran tactile, pour modifier son contenu.

![Structural Tables Live Preview](../assets/structural-tables-live-preview-en.png)

### Réglages de l’apparence

![Structural Tables settings](../assets/structural-tables-settings-en.png)

<!-- section: features -->
## Fonctions

- Saisissez `<` pour fusionner avec la colonne précédente dans le code source, ou `^` pour fusionner avec la cellule au-dessus.
- Placez `||` sans espace dans la ligne de séparation pour indiquer les colonnes qui servent d’en-têtes de lignes.
- Affichez les cellules fusionnées en mode lecture et dans l’aperçu en direct.
- Ajoutez, déplacez et supprimez des lignes ou colonnes, ou inversez lignes et colonnes du tableau entier.
- Copiez au format HTML, GFM standard, TSV ou CSV. Sur ordinateur, exportez une image PNG.
- Collez des tableaux HTML compatibles provenant du navigateur ou d’un tableur.
- Convertissez un tableau en Obsidian Base après avoir vérifié les enregistrements proposés.
- Les écritures susceptibles de supprimer des données non sélectionnées sont refusées, sauf en cas de suppression explicite.

<!-- section: requirements-and-compatibility -->
## Prérequis et compatibilité

Obsidian 1.12.7 ou une version ultérieure est nécessaire. Compatible avec ordinateur et Android. Activez le module principal Bases pour convertir un tableau en Base.

`<`, `^` et `||` sont une extension de syntaxe : d’autres éditeurs Markdown peuvent afficher les fusions différemment. Avec Advanced Tables, utilisez « Modifier le code Markdown du tableau » et vérifiez les données après tout tri externe.

<!-- section: installation -->
## Installation

Dans Obsidian, ouvrez « Paramètres → Modules communautaires → Parcourir », recherchez Structural Tables, installez et activez le module.

Pour l’installation manuelle, extrayez `structural-tables-<version>.zip` dans `Vault/.obsidian/plugins/`, rechargez Obsidian, puis activez le module.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Utilisation

Créez un tableau Markdown et utilisez cette syntaxe :

```markdown
| Region | Sales | < |
| Quarter | Q1 | Q2 |
| --- || --- | --- |
| North | 10 | 12 |
| ^ | 8 | 11 |
```

`<` fusionne avec la colonne précédente dans l’ordre du code source ; `^` fusionne vers le haut. Le `||` de la ligne de séparation délimite les en-têtes de lignes, sans ajouter de colonne.

Cliquez une cellule en aperçu en direct. Entrée enregistre et passe à la suivante, Maj+Entrée insère un saut de ligne, Échap annule. Faites glisser les poignées pour déplacer les lignes et colonnes.

Avec une sélection de cellules, Suppr/Retour arrière efface uniquement le texte sans supprimer les lignes ou fusions. Utilisez le menu contextuel pour supprimer lignes, colonnes ou tableau. Les modifications peuvent être annulées.

La copie, la coupe et le collage de plages conservent la structure fusionnée lorsque la cible est compatible. Sur mobile, cette information de fusion disparaît après redémarrage ou remplacement du presse-papiers.

Sur ordinateur, prévisualisez, copiez ou enregistrez une image PNG du tableau entier. Les modifications de cellule non enregistrées sont exclues. L’export PNG n’est pas disponible sur mobile.

Enregistrez la note et sortez les tableaux des listes ou citations avant une conversion en Base. Les fusions sont aplaties ; la restauration de la table initiale conserve les notes créées.

<!-- section: settings -->
## Paramètres

« Général » : langue, collage HTML et avertissements. « Vues » : lecture, aperçu, erreurs et prise en charge des tableaux GFM normaux. « Apparence » : style, largeur, espacement et couleurs alternées.

Choisissez Suivre le thème, Grille ou Tableau à trois lignes. Modifier l’apparence ou la langue de l’interface ne change ni le Markdown ni le sens du texte de la note.

<!-- section: limitations -->
## Limites

Ce module n’est pas un tableur et ne calcule pas les formules. Il ne gère pas les styles par cellule, les légendes, le Markdown de bloc dans les cellules ni les véritables cellules multiligne dans la source.

Le HTML importé devient du texte avec des sauts visuels `<br>` pris en charge. Le GFM ordinaire ne conserve pas toutes les fusions ; la conversion en Base aplatit les en-têtes.

<!-- section: privacy-and-security -->
## Confidentialité et sécurité

Les tableaux sont traités localement. Aucune note n’est téléversée et aucune statistique d’utilisation n’est collectée. La lecture ne modifie pas Markdown.

Les images et polices distantes suivent le comportement réseau d’Obsidian et du thème. Ne publiez pas de contenu privé ou de chemins personnels dans les issues.

<!-- section: development -->
## Développement

Utilisez Node 24.19.0 et npm 11.17.0. Installez les dépendances et lancez les contrôles :

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## Assistance

Questions dans Q&A, idées dans Ideas, erreurs reproductibles dans GitHub Issues. Indiquez la version d’Obsidian, le thème, le Markdown du tableau, le résultat attendu et observé.

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

Signalez les failles de sécurité uniquement par le formulaire confidentiel prévu à cet effet.

<!-- section: license -->
## Licence

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
