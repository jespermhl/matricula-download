// ==UserScript==
// @name         Matricula Online – Bild-Downloader
// @namespace    https://data.matricula-online.eu/
// @version      2.0.0
// @description  Fügt einen Download-Button in den Matricula Online Bildbetrachter ein. Kein Netzwerk-Tab mehr nötig.
// @author       Jesper Mahel
// @match        https://data.matricula-online.eu/*
// @match        https://*.matricula-online.eu/*
// @grant        GM_download
// @grant        GM_addStyle
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // ─── Styling ───────────────────────────────────────────────────────────────

    GM_addStyle(`
        #mat-dl-panel {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        #mat-dl-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 12px;
            font-size: 14px;
            font-weight: 500;
            line-height: 1.4;
            color: #fff;
            background: #2eb5e8;
            border: 1px solid #24a0d1;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.15s ease, box-shadow 0.15s ease;
            white-space: nowrap;
            user-select: none;
            font-family: inherit;
        }

        #mat-dl-btn:hover { background: #1e9fcc; box-shadow: 0 2px 6px rgba(0,0,0,0.25); }
        #mat-dl-btn:active { background: #178cb5; }
        #mat-dl-btn:disabled { opacity: 0.6; cursor: wait; }

        #mat-dl-open-btn {
            display: inline-flex;
            align-items: center;
            padding: 5px 10px;
            font-size: 14px;
            line-height: 1.4;
            color: #2eb5e8;
            background: transparent;
            border: 1px solid #2eb5e8;
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.15s ease;
            white-space: nowrap;
            user-select: none;
            font-family: inherit;
        }
        #mat-dl-open-btn:hover { background: rgba(46,181,232,0.12); }

        /* Toast */
        #mat-dl-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #fff;
            background: #333;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            pointer-events: none;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.25s ease, transform 0.25s ease;
            max-width: 360px;
        }
        #mat-dl-toast.show   { opacity: 1; transform: translateY(0); }
        #mat-dl-toast.ok     { background: #28a745; }
        #mat-dl-toast.err    { background: #dc3545; }
        #mat-dl-toast.info   { background: #2eb5e8; }
    `);

    // ─── Toast ─────────────────────────────────────────────────────────────────

    function toast(msg, type = 'info', ms = 3500) {
        let el = document.getElementById('mat-dl-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'mat-dl-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.className = `show ${type}`;
        clearTimeout(el._t);
        el._t = setTimeout(() => { el.className = ''; }, ms);
    }

    // ─── Filename builder ──────────────────────────────────────────────────────

    function buildFilename(imageUrl) {
        // Try to extract the original filename from the decoded internal URL
        // e.g. "hosted-images.…/Weeze-StCyriacus_KB02_S_013.jpg" → use that name
        if (imageUrl) {
            try {
                const decoded = decodeInternalUrl(imageUrl);
                if (decoded) {
                    const name = decoded.split('/').pop();
                    if (name && /\.jpg/i.test(name)) return name;
                }
            } catch (_) {}
        }

        // Fallback: build from page URL
        const path = window.location.pathname
            .replace(/^\/[a-z]{2}\//, '')
            .replace(/\/$/, '')
            .replace(/\//g, '_');
        const pg = new URLSearchParams(window.location.search).get('pg') || '1';
        return `${path || 'matricula'}_pg${String(pg).padStart(3, '0')}.jpg`;
    }

    // ─── Core: Image URL extraction ────────────────────────────────────────────

    /**
     * The actual image URL schema on Matricula Online (discovered via network analysis):
     *
     *   https://img.data.matricula-online.eu/image/{base64(internal_url)}/?csrf=TOKEN&ctrl=HASH
     *
     * Where base64 decodes to:
     *   http://hosted-images.matricula-online.eu/images/matricula/…/<page>.jpg
     *
     * Strategies (in priority order):
     *   1. Network interceptor – hook Image.src setter + fetch + XHR
     *   2. Script scan – find the base64 URL in OSD init scripts on the page
     *   3. PerformanceObserver – read from browser's resource timing API
     */

    let _capturedProxyUrl  = null;  // full proxy URL with CSRF (most reliable for download)
    let _capturedInternalUrl = null; // decoded hosted-images URL (fallback)

    /** Decode the base64 segment from a Matricula proxy URL to get the internal URL. */
    function decodeInternalUrl(proxyUrl) {
        const m = proxyUrl.match(/\/image\/([A-Za-z0-9+/=_-]+)/);
        if (!m) return null;
        try {
            // Handle URL-safe base64 (- → +, _ → /)
            const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
            return atob(b64);
        } catch (_) {
            return null;
        }
    }

    /** Check if a URL is a Matricula book-page image URL (proxy or internal). */
    function isBookImageUrl(url) {
        if (typeof url !== 'string') return false;
        return /img\.data\.matricula-online\.eu\/image\//i.test(url)
            || /hosted-images\.matricula-online\.eu\/images\//i.test(url);
    }

    /** Install hooks to capture image URLs as the viewer loads them. */
    function installInterceptors() {
        // ── 1. Hook Image.prototype.src setter (OSD uses new Image() internally) ──
        const imgProto = HTMLImageElement.prototype;
        const srcDescriptor = Object.getOwnPropertyDescriptor(imgProto, 'src')
            || Object.getOwnPropertyDescriptor(Element.prototype, 'src');

        if (srcDescriptor && srcDescriptor.set) {
            const origSrcSet = srcDescriptor.set;
            Object.defineProperty(imgProto, 'src', {
                set(value) {
                    if (isBookImageUrl(value)) {
                        _capturedProxyUrl = value;
                        _capturedInternalUrl = decodeInternalUrl(value);
                    }
                    origSrcSet.call(this, value);
                },
                get: srcDescriptor.get,
                configurable: true,
            });
        }

        // ── 2. Hook fetch ──
        const origFetch = window.fetch;
        window.fetch = function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
            if (isBookImageUrl(url)) {
                _capturedProxyUrl = url;
                _capturedInternalUrl = decodeInternalUrl(url);
            }
            return origFetch.apply(this, args);
        };

        // ── 3. Hook XMLHttpRequest ──
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (typeof url === 'string' && isBookImageUrl(url)) {
                _capturedProxyUrl = url;
                _capturedInternalUrl = decodeInternalUrl(url);
            }
            return origOpen.call(this, method, url, ...rest);
        };

        // ── 4. PerformanceObserver (catches anything we might miss above) ──
        if (typeof PerformanceObserver !== 'undefined') {
            const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (isBookImageUrl(entry.name)) {
                        _capturedProxyUrl = entry.name;
                        _capturedInternalUrl = decodeInternalUrl(entry.name);
                    }
                }
            });
            try {
                po.observe({ type: 'resource', buffered: true });
            } catch (_) {}
        }
    }

    /**
     * Scan inline <script> tags for the OSD initialisation block.
     * Matricula embeds the image URL (base64-encoded) directly in the page JS.
     *
     * Looks for patterns like:
     *   url: "https://img.data.matricula-online.eu/image/BASE64/?csrf=…&ctrl=…"
     *   "image_url": "https://img.data.matricula-online.eu/image/…"
     */
    function findUrlInScripts() {
        const pattern = /(https?:\/\/img\.data\.matricula-online\.eu\/image\/[A-Za-z0-9+/=_%-]+(?:\/?\?[^"'\s]*)?)/i;
        for (const script of document.querySelectorAll('script:not([src])')) {
            const m = (script.textContent || '').match(pattern);
            if (m) return m[1];
        }
        return null;
    }

    /** Also check the page's data- attributes and hidden inputs for URLs. */
    function findUrlInDOM() {
        // Some viewers store config in data-* attributes
        for (const el of document.querySelectorAll('[data-image-url],[data-src],[data-url]')) {
            const url = el.dataset.imageUrl || el.dataset.src || el.dataset.url || '';
            if (isBookImageUrl(url)) return url;
        }
        // <img> tags that OSD may have spawned (less likely for canvas-based OSD)
        for (const img of document.querySelectorAll('img')) {
            if (isBookImageUrl(img.src)) return img.src;
        }
        return null;
    }

    /** Master: return the best URL we have. */
    function getImageUrl() {
        return _capturedProxyUrl
            || findUrlInScripts()
            || findUrlInDOM()
            || null;
    }

    // ─── Download ──────────────────────────────────────────────────────────────

    function doDownload() {
        const url = getImageUrl();

        if (!url) {
            toast('⚠ Kein Bild gefunden – bitte warten bis das Bild geladen ist.', 'err', 5000);
            return;
        }

        const filename = buildFilename(url);
        const btn = document.getElementById('mat-dl-btn');
        if (btn) btn.disabled = true;

        console.log('[Matricula DL] Downloading:', url, '→', filename);

        if (typeof GM_download === 'function') {
            GM_download({
                url,
                name: filename,
                saveAs: false,
                onload: () => {
                    if (btn) btn.disabled = false;
                    toast(`✓ Gespeichert: ${filename}`, 'ok');
                },
                onerror: (err) => {
                    if (btn) btn.disabled = false;
                    console.warn('[Matricula DL] GM_download failed:', err);
                    // Fallback: open in new tab
                    window.open(url, '_blank');
                    toast('⬇ Im neuen Tab geöffnet (Rechtsklick → Speichern)', 'info', 5000);
                }
            });
        } else {
            // Plain anchor fallback
            const a = Object.assign(document.createElement('a'), {
                href: url, download: filename, target: '_blank'
            });
            document.body.appendChild(a);
            a.click();
            a.remove();
            if (btn) btn.disabled = false;
            toast(`⬇ Download gestartet`, 'info');
        }
    }

    function doOpenInTab() {
        const url = getImageUrl();
        if (!url) { toast('⚠ Kein Bild gefunden.', 'err'); return; }
        window.open(url, '_blank');
    }

    // ─── UI ────────────────────────────────────────────────────────────────────

    const SVG_DL = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 16l-6-6h4V4h4v6h4l-6 6z"/><path d="M20 18H4v2h16v-2z"/>
    </svg>`;
    const SVG_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M14 3v2H5v14h14v-9h2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9zM21 3v6h-2V6.41l-7.29 7.3-1.42-1.42L17.59 5H15V3h6z"/>
    </svg>`;

    function isViewerPage() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        // Viewer pages have at least: lang / country / region / parish / book
        return parts.length >= 5
            || window.location.search.includes('pg=')
            || window.location.search.includes('page=');
    }

    function injectUI() {
        if (document.getElementById('mat-dl-panel')) return;
        if (!isViewerPage()) return;

        const panel = document.createElement('div');
        panel.id = 'mat-dl-panel';

        const dlBtn = document.createElement('button');
        dlBtn.id = 'mat-dl-btn';
        dlBtn.type = 'button';
        dlBtn.title = 'Aktuelles Kirchenbuch-Bild herunterladen';
        dlBtn.innerHTML = `${SVG_DL} Bild herunterladen`;
        dlBtn.addEventListener('click', doDownload);

        const openBtn = document.createElement('button');
        openBtn.id = 'mat-dl-open-btn';
        openBtn.type = 'button';
        openBtn.title = 'Direkten Bildlink in neuem Tab öffnen';
        openBtn.innerHTML = SVG_OPEN;
        openBtn.addEventListener('click', doOpenInTab);

        panel.appendChild(dlBtn);
        panel.appendChild(openBtn);

        // Inject into Matricula's Bootstrap navbar (.navbar-nav.ml-auto = right side)
        const targets = [
            document.querySelector('.navbar-nav.ml-auto'),
            document.querySelector('ul.navbar-nav'),
            document.querySelector('.navbar'),
        ];
        const toolbar = targets.find(Boolean);

        if (toolbar?.tagName === 'UL') {
            const li = document.createElement('li');
            li.className = 'nav-item';
            li.style.cssText = 'display:flex;align-items:center;padding:0 8px;';
            li.appendChild(panel);
            // Insert before the last item (Matricula-Unterstützen button)
            toolbar.insertBefore(li, toolbar.lastElementChild);
        } else if (toolbar) {
            panel.style.padding = '0 10px';
            toolbar.prepend(panel);
        } else {
            // Floating fallback
            const wrap = document.createElement('div');
            wrap.style.cssText = `position:fixed;top:66px;right:16px;z-index:99999;
                background:#fff;border:1px solid #dee2e6;border-radius:6px;
                padding:8px 12px;box-shadow:0 2px 10px rgba(0,0,0,0.15);`;
            wrap.appendChild(panel);
            document.body.appendChild(wrap);
        }

        if (!document.getElementById('mat-dl-toast')) {
            document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mat-dl-toast' }));
        }

        console.log('[Matricula DL] ✓ v2.0 injected');
    }

    // ─── SPA navigation ────────────────────────────────────────────────────────

    let _lastHref = location.href;
    new MutationObserver(() => {
        if (location.href === _lastHref) return;
        _lastHref = location.href;
        _capturedProxyUrl = null;
        _capturedInternalUrl = null;
        const old = document.getElementById('mat-dl-panel');
        if (old) (old.closest('li') || old).remove();
        setTimeout(injectUI, 800);
    }).observe(document.body, { childList: true, subtree: true });

    // ─── Bootstrap ────────────────────────────────────────────────────────────

    installInterceptors();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(injectUI, 500));
    } else {
        setTimeout(injectUI, 500);
    }

})();
