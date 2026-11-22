# Matricula Online – Bild-Downloader (Userscript)

Ein Tampermonkey/Greasemonkey-Userscript, das einen **Download-Button** direkt in den Matricula Online Bildbetrachter integriert – kein Öffnen des Netzwerk-Tabs mehr nötig.

## Vorschau

Der Button erscheint nahtlos in der Navigationsleiste:

```
[Matricula Online] | [Bestände] [Landkarte] [Ortssuche]  [⬇ Bild herunterladen] [🔗] | [Matricula unterstützen]
```

## Installation

### 1. Browser-Erweiterung installieren

- **Chrome/Edge/Opera**: [Tampermonkey](https://www.tampermonkey.net/)
- **Firefox**: [Tampermonkey](https://addons.mozilla.org/de/firefox/addon/tampermonkey/) oder [Greasemonkey](https://addons.mozilla.org/de/firefox/addon/greasemonkey/)
- **Safari**: [Tampermonkey](https://apps.apple.com/app/tampermonkey/id1482490089)

### 2. Userscript installieren

**Option A – Direkte Installation:**  
Klicke auf die Datei `matricula-image-downloader.user.js` im Browser. Tampermonkey erkennt Userscripts automatisch und fragt nach Installation.

**Option B – Manuell:**
1. Tampermonkey-Icon klicken → „Neues Script erstellen"
2. Den Inhalt von `matricula-image-downloader.user.js` einfügen
3. Speichern (`Strg+S`)

## Verwendung

1. Öffne ein Kirchenbuch auf [data.matricula-online.eu](https://data.matricula-online.eu)  
   z.B. `https://data.matricula-online.eu/de/deutschland/dresden/bautzen/11/?pg=1`
2. Warte bis das Bild geladen ist
3. Klicke auf **„⬇ Bild herunterladen"** in der Navigationsleiste

Das Bild wird als `{land}_{region}_{pfarrei}_{buch}_pg{NNN}.jpg` gespeichert.

Das kleine **🔗-Symbol** öffnet das Bild direkt im Browser (zum manuellen Speichern).

## Wie es funktioniert

Das Script verwendet drei Strategien, um die Bild-URL zu finden (in Reihenfolge der Zuverlässigkeit):

1. **Netzwerk-Interceptor** (zuverlässigste Methode): Überwacht alle `fetch()`- und `XHR`-Anfragen des Bildviewers und fängt die Bild-URL ab, sobald sie angefragt wird
2. **DOM-Scan**: Sucht nach `<img>`-Elementen mit dem Matricula CDN-Hostnamen
3. **URL-Rekonstruktion**: Baut die Bild-URL aus der aktuellen Seiten-URL nach dem bekannten Muster `https://img.matricula-online.eu/{land}/{region}/{pfarrei}/{buch}/{NNNN}.jpg` nach

## Kompatibilität

- ✅ Alle modernen Browser (Chrome, Firefox, Edge, Safari)
- ✅ Tampermonkey (empfohlen – nutzt `GM_download` für direkten Download)
- ✅ Greasemonkey (Fallback auf Anker-Download)
- ✅ Funktioniert mit SPA-Navigation (kein Neuladen der Seite nötig)

## Lizenz

MIT
