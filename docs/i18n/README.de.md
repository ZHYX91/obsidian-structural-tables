# Structural Tables

[English](../../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md) · [Tiếng Việt](README.vi.md) · [العربية](README.ar.md)

Dieser kompakte Einstieg erklärt die wichtigsten Funktionen und Grenzen. Ausführliche Anleitungen gibt es auf [English](../../README.md) und [简体中文](README.zh-CN.md).

Erweitert Markdown-Tabellen um verbundene Zellen, mehrere Kopfzeilen, Zeilenüberschriften und Tabellen ohne Spaltenüberschriften. Das Anzeigen einer Tabelle verändert den Markdown-Text nicht.

## Screenshots

### Dreilinientabelle in der Leseansicht

Mehrzeilige Spaltenüberschriften und verbundene Zeilenüberschriften werden angezeigt, ohne jede Zelle vollständig zu umranden.

![Dreilinientabelle mit verbundenen Zellen in der Leseansicht](../assets/structural-tables-reading-view-en.png)

### Bearbeiten in der Live-Vorschau

Auf dem Desktop eine Zelle anklicken, auf Touchgeräten doppelt antippen, um Text direkt zu bearbeiten.

![Zellen in der Live-Vorschau bearbeiten](../assets/structural-tables-live-preview-en.png)

### Darstellungseinstellungen

![Darstellungseinstellungen von Structural Tables](../assets/structural-tables-settings-en.png)

<!-- section: features -->
## Funktionen

- Mit `<` wird eine Zelle mit der vorherigen Quellspalte verbunden, mit `^` mit der darüberliegenden Zelle.
- Ein direkt benachbartes `||` in der Trennzeile kennzeichnet Spalten als Zeilenüberschriften; mehrere Kopfzeilen sind möglich.
- Leseansicht und Live-Vorschau zeigen dieselbe Verbindungsstruktur.
- Zeilen und Spalten hinzufügen, verschieben, löschen oder die gesamte Tabelle transponieren.
- Als HTML, normales GFM, TSV oder CSV kopieren; auf dem Desktop als PNG exportieren.
- Unterstützte HTML-Tabellen aus Browsern und Tabellenkalkulationen einfügen.
- Tabellen nach Vorschau in eine Obsidian Base umwandeln.
- Unbeabsichtigter Verlust nicht ausgewählter Inhalte wird verhindert; ausdrücklich gewähltes Löschen bleibt möglich.

<!-- section: requirements-and-compatibility -->
## Voraussetzungen und Kompatibilität

Benötigt Obsidian 1.12.7 oder neuer. Unterstützt Desktop und Android. Für die Umwandlung in eine Base muss das Obsidian-Kernplugin Bases aktiviert sein.

`<`, `^` und `||` sind zusätzliche Markdown-Syntax und werden in anderen Editoren möglicherweise anders angezeigt. Für Advanced Tables zuerst „Tabellenquelltext bearbeiten“ wählen und nach externem Sortieren Inhalt und Verbindungen prüfen.

<!-- section: installation -->
## Installation

Unter „Einstellungen → Community-Erweiterungen → Durchsuchen“ nach Structural Tables suchen, installieren und aktivieren.

Zur manuellen Installation `structural-tables-<version>.zip` nach `Vault/.obsidian/plugins/` entpacken, Obsidian neu laden und die Erweiterung aktivieren.

[GitHub Releases](https://github.com/ZHYX91/obsidian-structural-tables/releases/latest).

<!-- section: usage -->
## Verwendung

Eine Markdown-Tabelle anlegen und folgende Syntax verwenden:

```markdown
| Region | Umsatz | < |
| Quartal | Q1 | Q2 |
| --- || --- | --- |
| Norden | 10 | 12 |
| ^ | 8 | 11 |
```

`<` verbindet nach links in Quellreihenfolge, `^` nach oben. Das `||` in der Trennzeile kennzeichnet die Grenze der Zeilenüberschriften und fügt keine Spalte hinzu.

In der Live-Vorschau eine Zelle anklicken. Enter speichert und wechselt, Shift+Enter fügt einen Umbruch ein, Escape bricht ab. Zeilen oder Spalten lassen sich am Griff ziehen.

Delete/Backspace leert bei einer Rasterauswahl nur den Zellinhalt. Für Zeilen-, Spalten- oder Tabellenlöschung das Kontextmenü verwenden. Ausdrückliche Änderungen lassen sich rückgängig machen.

Bereiche lassen sich kopieren, ausschneiden und nur bei passender Verbindungsstruktur wieder einfügen. Auf Mobilgeräten gehen die gespeicherten Verbindungsdaten nach einem Neustart oder Wechsel des Zwischenablageninhalts verloren.

Auf dem Desktop können Sie die komplette Tabelle als PNG prüfen, kopieren und speichern. Ungespeicherte Zellbearbeitungen fehlen im Bild. Auf Mobilgeräten steht der PNG-Export nicht zur Verfügung.

Vor der Base-Umwandlung die Notiz speichern und Tabellen aus Zitaten oder Listen auf die oberste Ebene verschieben. Verbindungen werden aufgelöst. Das Wiederherstellen der Ursprungstabelle löscht erzeugte Datensatznotizen nicht.

### Normale Markdown-Tabellen

Normale GFM-Tabellen werden zunächst mit Obsidians eigenem Editor bearbeitet. Erst die Option „Gewöhnliche Markdown-Tabellen übernehmen“ aktiviert die Bedienelemente dieses Plugins. Wenn eine Datenzeile mehr Quellzellen als die Kopfzeile enthält, können unsichtbare Inhalte vorhanden sein. Bearbeiten Sie diese erst über „Tabellenquelltext bearbeiten“, statt sie stillschweigend zu verlieren.

### Formeln und Zeilenumbrüche

Shift+Enter fügt einen sichtbaren Zeilenumbruch ein, der als unterstütztes `<br>` gespeichert wird. Ein nicht maskiertes `|` innerhalb einer Formel kann wie ein Tabellentrenner wirken. In diesem Fall bleibt der Entwurf erhalten und das Speichern wird abgelehnt. Verwenden Sie je nach Bedeutung die TeX-Befehle `\lvert`, `\rvert` oder `\mid`.

### Einfügen und Kopieren

HTML-Tabellen werden nur dann in Markdown umgewandelt, wenn die Zellstruktur sicher übernommen werden kann. Bei schwierigen Formatierungen wird gegebenenfalls der vollständige Klartext eingefügt oder Obsidians normale Einfügefunktion verwendet. Klartext bewahrt weder Zellverbindungen noch Formatierung. Nach einer Umwandlung in gewöhnliches GFM sollten Sie das Ergebnis im Zielprogramm prüfen.

### In einfaches GFM umwandeln

Klicke mit der rechten Maustaste auf die Tabelle und wähle „In einfache GFM-Tabelle umwandeln…“. Im Editor kannst du den Cursor auch in den Tabellenquelltext setzen und den Befehl zur Umwandlung in einfaches GFM aufrufen.

Bei Tabellen mit ausschließlich Zeilenüberschriften empfiehlt sich das Tauschen von Zeilen und Spalten: Die Beschriftungen werden zur obersten Kopfzeile. Bleibt die ursprüngliche Ausrichtung ohne Spaltenüberschriften erhalten, wird oben eine leere Kopfzeile ergänzt; alle vorhandenen Datenzeilen bleiben bestehen.

Verbundene Zellen werden getrennt. Ihr Inhalt wird an jeder zuvor überdeckten Position wiederholt. Mehrere Kopfzeilen werden zu einer Zeile zusammengeführt. Die Ebenen werden mit „ / “ verbunden. An der Seite verbleibende Zeilenüberschriften werden zu normalen Zellen; GFM erhält ihre Überschriftenrolle nicht.

Wechsle zwischen Ergebnisvorschau und Markdown-Quelltext und kopiere das aktuelle Ergebnis oder ersetze die ursprüngliche Tabelle. Die Leseansicht bietet nur Kopieren. Ersetzen ist eine einzelne Änderung, die sich mit einmal Rückgängig wiederherstellen lässt; Schließen ändert den Quelltext nicht. Beende zuerst offene Zellbearbeitungen. Hat sich die ursprüngliche Tabelle oder Datei geändert, öffne die Vorschau erneut. Der direkte GFM-Kopierbefehl verwendet die empfohlene Ausrichtung.

### PNG-Grenzen und Base-Wiederherstellung

PNG-Bilder sind auf 8192 Pixel je Seite und 16 Megapixel begrenzt. Wenn nicht die ganze Tabelle erfasst werden kann, entsteht kein beschnittenes Bild. Die Base-Umwandlung erstellt Datensatznotizen und die Datei `_promotion.json`. Die Wiederherstellung setzt die ursprüngliche Tabelle zurück, übernimmt keine späteren Base-Änderungen und löscht die erzeugten Notizen nicht.

<!-- section: settings -->
## Einstellungen

„Allgemein“: Sprache, HTML-Einfügen, Konfliktwarnungen. „Ansichten“: Leseansicht, Live-Vorschau, Hinweise und Übernahme normaler GFM-Tabellen. „Darstellung“: Tabellenstil, Breite, Abstand und wechselnde Zeilenfarben.

Wählen Sie „Dem Theme folgen“, Raster oder Dreilinientabelle. Darstellung und Oberflächensprache verändern weder Markdown noch die Schreibrichtung der Notiz.

<!-- section: limitations -->
## Einschränkungen

Dies ist keine Tabellenkalkulation und berechnet keine Formeln. Zellbezogene Formatierung, Beschriftungen, Block-Markdown und echte mehrzeilige Quellzellen werden nicht unterstützt.

Importiertes HTML wird zu Text und unterstützten visuellen `<br>`-Zeilenumbrüchen. Normales GFM kann nicht jede Verbindung darstellen; die Base-Konvertierung verflacht die Kopfstruktur.

<!-- section: privacy-and-security -->
## Datenschutz und Sicherheit

Tabellen werden lokal verarbeitet. Notizen werden nicht hochgeladen und es werden keine Analysedaten gesammelt. Reines Anzeigen ändert kein Markdown.

Externe Bilder und Schriftarten unterliegen den Netzwerkeinstellungen von Obsidian und des Themes. Veröffentlichen Sie keine vertraulichen Notizinhalte oder Pfade in Issues.

<!-- section: development -->
## Entwicklung

Verwenden Sie Node 24.19.0 und npm 11.17.0. Abhängigkeiten installieren und Prüfungen ausführen:

```bash
npm ci
npm run check
```

[Architecture](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/docs/architecture.en.md) · [Contributing](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CONTRIBUTING.md) · [Changelog](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/CHANGELOG.md)

<!-- section: support -->
## Hilfe

Fragen unter Q&A, Ideen unter Ideas und reproduzierbare Fehler unter GitHub Issues melden. Bitte Obsidian-Version, Theme, Tabellen-Markdown sowie Soll- und Ist-Ergebnis angeben.

[Q&A](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/q-a) · [Ideas](https://github.com/ZHYX91/obsidian-structural-tables/discussions/categories/ideas) · [GitHub Issues](https://github.com/ZHYX91/obsidian-structural-tables/issues/new/choose) · [Private security reporting](https://github.com/ZHYX91/obsidian-structural-tables/security/advisories/new)

Sicherheitslücken ausschließlich vertraulich über die private Meldestelle melden.

<!-- section: license -->
## Lizenz

[MIT](https://github.com/ZHYX91/obsidian-structural-tables/blob/main/LICENSE) © ZhengYX
