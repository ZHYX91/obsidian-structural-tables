# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Voici les opérations courantes et les précautions à connaître. Les guides [anglais](../../README.md) et [chinois simplifié](README.zh-CN.md) détaillent les cas particuliers.

Ajoutez des cellules fusionnées, plusieurs lignes d’en-têtes, des en-têtes de lignes et des tableaux sans en-tête à vos tableaux Markdown. Afficher une table ne réécrit jamais le Markdown de la note.

## Captures d’écran

### Tableau à trois lignes en mode lecture

Les en-têtes groupés et les cellules fusionnées restent visibles sans encadrer chaque cellule.

![Tableau à trois lignes avec cellules fusionnées en mode lecture](../assets/structural-tables-reading-view-en.png)

### Modification dans l’aperçu en direct

Cliquez une cellule sur ordinateur, ou appuyez deux fois sur un écran tactile, pour modifier son contenu.

![Édition directe d’une cellule dans l’aperçu en direct](../assets/structural-tables-live-preview-en.png)

### Réglages de l’apparence

![Réglages de l’apparence de Structural Tables](../assets/structural-tables-settings-en.png)

L’image des réglages montre les composants réels de paramètres et de tableau dans un navigateur de test, pas une capture d’Obsidian.

<!-- section: features -->
## Fonctions

- Conversion dans les deux sens entre tableaux Markdown et HTML, avec aperçu et avertissements sur les pertes possibles.

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

### À propos de la compatibilité des tableaux : une explication et mes excuses

*2026-10-31*

Comme [Number Suite](https://github.com/ZHYX91/obsidian-number-suite), Structural Tables était au départ un petit outil conçu pour mes besoins particuliers lorsque je travaillais sur des articles scientifiques dans Obsidian. Je n’utilisais qu’une petite partie de LaTeX et je pensais pouvoir la remplacer par quelques extensions Markdown. Je me suis surtout concentré sur mon propre usage, sans assez tenir compte des autres utilisateurs ni de la compatibilité avec d’autres éditeurs Markdown.

L’ancienne syntaxe des tableaux sans en-têtes de colonne et des en-têtes de ligne ne respecte pas la structure des tableaux GFM. Certains éditeurs ne peuvent donc pas reconnaître ou afficher ces tableaux correctement. C’était une erreur de conception de ma part. Je suis désolé des difficultés rencontrées lors de la lecture, du partage ou du déplacement de notes.

Pour améliorer cela, le plugin permet maintenant de convertir les tableaux entre Markdown et HTML. Il peut conserver les en-têtes complexes et les cellules fusionnées lors du passage vers HTML, ou convertir un tableau HTML pris en charge vers Markdown. Il utilise le GFM ordinaire quand c’est possible et les extensions existantes seulement si nécessaire. Un aperçu permet de vérifier les éventuelles différences de contenu ou de présentation avant remplacement.

<!-- section: installation -->
## Installation

Dans Obsidian, ouvrez « Paramètres → Modules communautaires → Parcourir », recherchez Structural Tables, installez et activez le module.

Pour l’installation manuelle, extrayez `structural-tables-<version>.zip` dans `Vault/.obsidian/plugins/`, rechargez Obsidian, puis activez le module.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Utilisation

Placez le curseur sur une ligne vide, sans texte sélectionné, puis lancez **Insérer un tableau structuré** dans la palette de commandes. Le tableau d’exemple est inséré directement. Sortez le curseur du tableau dans l’aperçu en direct, ou passez en mode lecture, pour voir le résultat. Voici un exemple de même structure à adapter :

```markdown
| Région | Ventes | < |
| Trimestre | Q1 | Q2 |
| --- || --- | --- |
| Nord | 10 | 12 |
| ^ | 8 | 11 |
```

`<` fusionne avec la colonne précédente dans l’ordre du code source ; `^` fusionne vers le haut. Le `||` de la ligne de séparation délimite les en-têtes de lignes, sans ajouter de colonne.

Si un tableau s’affiche mal, lancez **Vérifier les tableaux de cette note** depuis la palette de commandes. La vérification signale les erreurs sans modifier le Markdown.

Cliquez une cellule en aperçu en direct. Entrée enregistre et passe à la suivante, Maj+Entrée insère un saut de ligne, Échap annule. Faites glisser les poignées pour déplacer les lignes et colonnes.

Avec une sélection de cellules, Suppr/Retour arrière efface uniquement le texte sans supprimer les lignes ou fusions. Utilisez le menu contextuel pour supprimer lignes, colonnes ou tableau. Les modifications peuvent être annulées.

La copie, la coupe et le collage de plages conservent la structure fusionnée lorsque la cible est compatible. Sur mobile, cette information de fusion disparaît après redémarrage ou remplacement du presse-papiers.

Sur ordinateur, prévisualisez, copiez ou enregistrez une image PNG du tableau entier. Les modifications de cellule non enregistrées sont exclues. L’export PNG n’est pas disponible sur mobile.

Enregistrez la note et sortez les tableaux des listes ou citations avant une conversion en Base. Les fusions sont aplaties ; la restauration de la table initiale conserve les notes créées.

Les cellules fusionnées dans les lignes de données doivent être séparées avant la conversion en Base. Après conversion, placez le curseur dans le bloc Base et lancez **Créer un enregistrement dans la Base actuelle** pour ajouter un enregistrement vide.

### Tableaux Markdown ordinaires

Les tableaux GFM ordinaires utilisent d’abord l’éditeur natif d’Obsidian. Activez « Gérer aussi les tableaux Markdown ordinaires » pour obtenir les commandes du plugin. Si une ligne contient davantage de cellules source que d’en-têtes, des données peuvent être invisibles. Ouvrez « Modifier le code Markdown du tableau » et corrigez-les avant toute opération structurelle.

### Formules et retours à la ligne

Maj+Entrée insère un saut de ligne visuel qui est enregistré sous une forme `<br>` prise en charge. Dans une formule, un caractère `|` non échappé peut être interprété comme un séparateur de tableau. Le plugin conserve alors le brouillon et refuse l’enregistrement risqué. Selon le sens voulu, utilisez les commandes TeX `\lvert`, `\rvert` ou `\mid`.

### Collage et copie

Le collage de tableaux HTML ne convertit que les structures pouvant être conservées sans perte. Si un format ne peut pas être repris, la version complète en texte brut peut être insérée ou le collage est laissé à Obsidian. Le texte brut ne conserve pas les cellules fusionnées ni la mise en forme. Vérifiez toujours le résultat lorsque vous convertissez un tableau en GFM ordinaire.

### Convertir en GFM standard

Faites un clic droit sur le tableau et choisissez « Convertir en tableau GFM simple… ». Dans l’éditeur, vous pouvez aussi placer le curseur dans le code du tableau et lancer la commande de conversion en GFM simple.

Pour un tableau qui n’a que des en-têtes de ligne, il est recommandé d’échanger les lignes et les colonnes : ces libellés deviennent la ligne d’en-tête supérieure. Si vous conservez l’orientation sans en-têtes de colonne, une ligne d’en-tête vide est ajoutée en haut et toutes les lignes de données sont conservées.

Les cellules fusionnées sont séparées. Leur contenu est répété à chaque position auparavant couverte. Les différentes lignes d’en-tête sont réunies en une seule. Les niveaux sont séparés par « / ». Les en-têtes de ligne qui restent sur le côté deviennent des cellules ordinaires ; GFM ne conserve pas leur rôle d’en-tête.

Alternez entre l’aperçu du résultat et la source Markdown, puis copiez le résultat courant ou remplacez le tableau d’origine. Le mode lecture propose uniquement la copie. Le remplacement constitue une seule modification, annulable en une fois ; fermer la fenêtre ne modifie pas la source. Terminez d’abord les modifications de cellule. Si le tableau ou son fichier a changé, rouvrez l’aperçu. La commande de copie directe en GFM utilise l’orientation recommandée.

### Limites PNG et restauration de Base

Un PNG ne peut pas dépasser 8192 pixels par côté ou 16 mégapixels au total. Si le tableau complet ne peut pas être capturé, aucune image tronquée n’est créée. La conversion en Base crée des notes d’enregistrement et le fichier `_promotion.json`. Restaurer le tableau ne récupère pas les modifications ultérieures de Base et ne supprime pas les notes déjà créées.

### Convertir les tableaux entre Markdown et HTML

Placez le curseur dans un tableau Markdown et lancez **Convertir le tableau Markdown actuel en HTML…**. Pour revenir à Markdown, placez-le dans un bloc source `<table>…</table>` complet et autonome dans l’éditeur Markdown, puis lancez **Convertir le tableau HTML actuel en Markdown…**. Chaque remplacement est précédé d’un aperçu et peut être annulé en une étape.

Le GFM ordinaire est privilégié ; `<`, `^` et `||` ne sont employés que pour les structures complexes. Les liens, formules et mises en forme riches non pris en charge sont refusés. Si les couleurs, largeurs ou autres attributs HTML doivent disparaître, une confirmation expresse est demandée. Le résultat HTML n’est pas éditable avec la grille visuelle du plugin : reconvertissez-le en Markdown pour modifier sa structure.

<!-- section: settings -->
## Paramètres

« Général » : langue, collage HTML et avertissements. « Vues » : lecture, aperçu, erreurs et prise en charge des tableaux GFM normaux. « Apparence » : style, largeur, espacement et couleurs alternées.

Choisissez Suivre le thème, Grille ou Tableau à trois lignes. Modifier l’apparence ou la langue de l’interface ne change ni le Markdown ni le sens du texte de la note.

Sous « Traits et fond » et « Disposition et espacement », un tableau d’exemple reflète immédiatement les changements. Il utilise du texte fixe et ne lit ni ne modifie aucune note. Les réglages s’appliquent aux tableaux du coffre et sont enregistrés automatiquement.

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
