# Matricula Online – Bild-Downloader

[![Version](https://img.shields.io/badge/version-1.3.0-blue)](https://github.com/jespermhl/matricula-download/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Ein Tampermonkey/Greasemonkey-Userscript, das einen **Download-Button** direkt in den Matricula Online Bildbetrachter integriert – kein Öffnen des Netzwerk-Tabs mehr nötig.

## Vorschau

Der Button erscheint nahtlos in der Navigationsleiste:

```
[Matricula Online] | [Bestände] [Landkarte] [Ortssuche]  [⬇ Bild herunterladen] [🔗] | [Matricula unterstützen]
```

## Installation

### 1. Browser-Erweiterung installieren

| Browser | Erweiterung |
|---------|------------|
| Chrome / Edge / Opera | [Tampermonkey](https://www.tampermonkey.net/) |
| Firefox | [Tampermonkey](https://addons.mozilla.org/de/firefox/addon/tampermonkey/) oder [Greasemonkey](https://addons.mozilla.org/de/firefox/addon/greasemonkey/) |
| Safari | [Tampermonkey](https://apps.apple.com/app/tampermonkey/id1482490089) |

### 2. Userscript installieren

**→ [Hier klicken zum Installieren](https://raw.githubusercontent.com/jespermhl/matricula-download/main/matricula-image-downloader.user.js)**

Tampermonkey erkennt `.user.js`-Dateien automatisch und zeigt einen Installations-Dialog.

Alternativ manuell:
1. Tampermonkey-Icon klicken → „Neues Script erstellen"
2. Den Inhalt von [`matricula-image-downloader.user.js`](matricula-image-downloader.user.js) einfügen
3. Speichern (`Strg+S`)

## Verwendung

1. Öffne ein Kirchenbuch auf [data.matricula-online.eu](https://data.matricula-online.eu)  
   z.B. `https://data.matricula-online.eu/de/deutschland/dresden/bautzen/11/?pg=1`
2. Warte bis das Bild geladen ist
3. Klicke auf **„⬇ Bild herunterladen"** in der Navigationsleiste

Das Bild wird als `{land}_{region}_{pfarrei}_{buch}_pg{NNN}.jpg` gespeichert.

Das kleine **🔗-Symbol** öffnet das Bild direkt im Browser (zum manuellen Speichern per Rechtsklick).

## Wie es funktioniert

Das Script verwendet drei Strategien, um die Bild-URL zu finden (in Reihenfolge der Zuverlässigkeit):

| # | Methode | Beschreibung |
|---|---------|-------------|
| 1 | **Netzwerk-Interceptor** | Patcht `fetch()` und `XHR` und fängt die URL ab, sobald der Viewer das Bild lädt |
| 2 | **DOM-Scan** | Sucht nach `<img>`-Elementen mit dem Matricula CDN-Hostnamen (`img.matricula-online.eu`) |
| 3 | **URL-Rekonstruktion** | Baut `https://img.matricula-online.eu/{land}/{region}/{pfarrei}/{buch}/{NNNN}.jpg` aus der Seiten-URL nach |

## Kompatibilität

- ✅ Chrome, Firefox, Edge, Safari
- ✅ Tampermonkey (empfohlen – nutzt `GM_download` für direkten Download)
- ✅ Greasemonkey (Fallback auf Anker-Download)
- ✅ SPA-Navigation (kein Neuladen der Seite nötig beim Blättern)

## Lizenz

[MIT](LICENSE)
