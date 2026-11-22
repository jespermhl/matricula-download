// ==UserScript==
// @name         Matricula Online – Bild-Downloader
// @namespace    https://data.matricula-online.eu/
// @version      1.3.0
// @description  Fügt einen Download-Button in den Matricula Online Bildbetrachter ein, damit du Kirchenbücher direkt herunterladen kannst ohne den Netzwerk-Tab zu öffnen.
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
            text-decoration: none;
            transition: background 0.15s ease, box-shadow 0.15s ease;
            white-space: nowrap;
            user-select: none;
            font-family: inherit;
        }

        #mat-dl-btn:hover {
            background: #1e9fcc;
            box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        }

        #mat-dl-btn:active {
            background: #178cb5;
        }

        #mat-dl-btn.mat-dl-loading {
            opacity: 0.7;
            cursor: wait;
        }

        #mat-dl-open-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 10px;
            font-size: 14px;
            font-weight: 500;
            line-height: 1.4;
            color: #2eb5e8;
            background: transparent;
            border: 1px solid #2eb5e8;
            border-radius: 4px;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.15s ease, color 0.15s ease;
            white-space: nowrap;
            user-select: none;
            font-family: inherit;
        }

        #mat-dl-open-btn:hover {
            background: rgba(46,181,232,0.12);
        }

        #mat-dl-status {
            font-size: 12px;
            color: #888;
            min-width: 50px;
        }

        /* Toast notification */
        #mat-dl-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 999999;
            padding: 10px 18px;
            border-radius: 6px;
            font-size: 14px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            color: #fff;
            background: #333;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            pointer-events: none;
            opacity: 0;
            transform: translateY(10px);
            transition: opacity 0.25s ease, transform 0.25s ease;
            max-width: 320px;
            word-break: break-all;
        }

        #mat-dl-toast.mat-toast-show   { opacity: 1; transform: translateY(0); }
        #mat-dl-toast.mat-toast-success { background: #28a745; }
        #mat-dl-toast.mat-toast-error   { background: #dc3545; }
        #mat-dl-toast.mat-toast-info    { background: #2eb5e8; }
    `);

    // ─── State ─────────────────────────────────────────────────────────────────

    /** URL captured by the network interceptor (most reliable source). */
    let _capturedImageUrl = null;

    // ─── Helpers ───────────────────────────────────────────────────────────────

    function showToast(message, type = 'info', duration = 3000) {
        let toast = document.getElementById('mat-dl-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'mat-dl-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.className = `mat-toast-show mat-toast-${type}`;
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.className = ''; }, duration);
    }

    /**
     * Build a sane filename from the current URL and page number.
     * e.g. "deutschland_dresden_bautzen_11_pg003.jpg"
     */
    function buildFilename() {
        const path = window.location.pathname
            .replace(/^\/[a-z]{2}\//, '')   // strip /de/ /en/ language prefix
            .replace(/\/$/, '')              // strip trailing slash
            .replace(/\//g, '_');            // slashes → underscores

        const params = new URLSearchParams(window.location.search);
        const page = params.get('pg') || params.get('page') || '1';
        const pg   = String(parseInt(page, 10) || 1).padStart(3, '0');

        return `${path || 'matricula'}_pg${pg}.jpg`;
    }

    // ─── Image URL extraction strategies ──────────────────────────────────────

    /** Strategy A: DOM scan for <img> with matricula CDN hostname. */
    function findInDOM() {
        const imgs = Array.from(document.querySelectorAll('img'));
        for (const img of imgs) {
            const src = img.src || img.getAttribute('data-src') || '';
            if (/img(?:\.|-images\.|-cdn\.)?matricula-online\.eu/.test(src)
                || (/matricula-online\.eu/.test(src) && /\.(jpg|jpeg|png|tif)(\?|$)/i.test(src))) {
                return src;
            }
        }
        return null;
    }

    /** Strategy B: Scan inline scripts / page source for JSON-embedded image URLs. */
    function findInScripts() {
        // Only scan <script> tags – much faster than scanning all innerHTML
        const scripts = Array.from(document.querySelectorAll('script:not([src])'));
        const patterns = [
            /["'](?:image_?url|imageUrl|url)["']\s*:\s*["']([^"']+\.(?:jpg|jpeg|png))["']/i,
            /(?:imageUrl|tilesUrl|imgUrl)\s*=\s*["']([^"']+\.(?:jpg|jpeg|png))["']/i,
            /"url"\s*:\s*"([^"]*(?:matricula|img)[^"]*\.(?:jpg|jpeg|png))"/i,
        ];
        for (const script of scripts) {
            const text = script.textContent || '';
            for (const pat of patterns) {
                const m = text.match(pat);
                if (m && m[1]) return m[1];
            }
        }
        return null;
    }

    /**
     * Strategy C: Reconstruct the image URL from the page URL using the
     * known Matricula CDN pattern observed via network analysis.
     *
     * Page URL:   https://data.matricula-online.eu/de/{country}/{region}/{parish}/{book}/?pg={N}
     * Image URL:  https://img.matricula-online.eu/{country}/{region}/{parish}/{book}/{NNNN}.jpg
     */
    function constructFromUrl() {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        // pathParts[0] is the language code – drop it
        if (pathParts.length < 2) return null;
        const rest = pathParts.slice(1);  // country, region, parish, book

        const params = new URLSearchParams(window.location.search);
        const page = parseInt(params.get('pg') || params.get('page') || '1', 10) || 1;
        const pg   = String(page).padStart(4, '0');

        return `https://img.matricula-online.eu/${rest.join('/')}/${pg}.jpg`;
    }

    /** Returns the best available image URL using all strategies. */
    function getImageUrl() {
        return _capturedImageUrl
            || findInDOM()
            || findInScripts()
            || constructFromUrl();
    }

    // ─── Network interceptor ───────────────────────────────────────────────────

    /**
     * Monkey-patch fetch and XHR so we can passively capture the actual image
     * URL as the viewer requests it. This is the most reliable strategy when
     * the viewer dynamically constructs its tile URLs.
     */
    function installNetworkInterceptor() {
        const isMosaicImageUrl = (url) =>
            typeof url === 'string'
            && /matricula-online\.eu/.test(url)
            && /\.(jpg|jpeg|png|tif|jp2)(\?|$)/i.test(url);

        // Patch fetch
        const origFetch = window.fetch;
        window.fetch = function (...args) {
            const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
            if (isMosaicImageUrl(url)) {
                _capturedImageUrl = url;
            }
            return origFetch.apply(this, args);
        };

        // Patch XHR
        const origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (typeof url === 'string' && isMosaicImageUrl(url)) {
                _capturedImageUrl = url;
            }
            return origOpen.call(this, method, url, ...rest);
        };
    }

    // ─── Download ──────────────────────────────────────────────────────────────

    function downloadImage(url, filename) {
        const btn    = document.getElementById('mat-dl-btn');
        const status = document.getElementById('mat-dl-status');

        if (btn)    btn.classList.add('mat-dl-loading');
        if (status) status.textContent = 'Lädt…';

        const done = (ok) => {
            if (btn)    btn.classList.remove('mat-dl-loading');
            if (status) status.textContent = '';
            if (ok) showToast(`✓ Gespeichert als "${filename}"`, 'success');
        };

        if (typeof GM_download === 'function') {
            GM_download({
                url,
                name: filename,
                saveAs: false,
                onload: () => done(true),
                onerror: (err) => {
                    console.warn('[Matricula DL] GM_download failed:', err);
                    // Fallback: open in new tab so user can save manually
                    window.open(url, '_blank');
                    done(false);
                    showToast('⬇ Im neuen Tab geöffnet (Rechtsklick → "Speichern unter")', 'info', 5000);
                }
            });
        } else {
            // Plain anchor fallback (works in Greasemonkey)
            const a    = document.createElement('a');
            a.href     = url;
            a.download = filename;
            a.target   = '_blank';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            done(true);
        }
    }

    // ─── UI construction ───────────────────────────────────────────────────────

    const ICON_DOWNLOAD = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 16l-6-6h4V4h4v6h4l-6 6z"/>
        <path d="M20 18H4v2h16v-2z"/>
    </svg>`;

    const ICON_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M14 3v2H5v14h14v-9h2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9zM21 3v6h-2V6.41l-7.29 7.3-1.42-1.42L17.59 5H15V3h6z"/>
    </svg>`;

    function buildPanel() {
        const panel = document.createElement('div');
        panel.id = 'mat-dl-panel';

        const dlBtn = document.createElement('button');
        dlBtn.id    = 'mat-dl-btn';
        dlBtn.type  = 'button';
        dlBtn.title = 'Aktuelles Kirchenbuch-Bild herunterladen';
        dlBtn.innerHTML = `${ICON_DOWNLOAD} Bild herunterladen`;
        dlBtn.addEventListener('click', () => {
            const url = getImageUrl();
            if (!url) {
                showToast('⚠ Kein Bild gefunden. Bitte Seite vollständig laden.', 'error', 4500);
                return;
            }
            downloadImage(url, buildFilename());
        });

        const openBtn = document.createElement('button');
        openBtn.id    = 'mat-dl-open-btn';
        openBtn.type  = 'button';
        openBtn.title = 'Bild in neuem Tab öffnen (direkter Bildlink)';
        openBtn.innerHTML = ICON_OPEN;
        openBtn.addEventListener('click', () => {
            const url = getImageUrl();
            if (url) window.open(url, '_blank');
            else showToast('⚠ Kein Bild gefunden.', 'error', 3000);
        });

        const status = document.createElement('span');
        status.id = 'mat-dl-status';

        panel.appendChild(dlBtn);
        panel.appendChild(openBtn);
        panel.appendChild(status);

        return panel;
    }

    /**
     * Whether we are on a viewer page that shows an image.
     * Matricula viewer URLs look like:
     *   /de/deutschland/dresden/bautzen/11/?pg=1
     * i.e. at least 4 path segments after the language code.
     */
    function isViewerPage() {
        const parts = window.location.pathname.split('/').filter(Boolean);
        return parts.length >= 5
            || window.location.search.includes('pg=')
            || window.location.search.includes('page=');
    }

    function injectUI() {
        if (document.getElementById('mat-dl-panel')) return;
        if (!isViewerPage()) return;

        const panel = buildPanel();

        // Try to find Matricula's navbar (Bootstrap ul.navbar-nav) and blend in
        // The right-side nav (.ml-auto) is the best spot so it's out of the way
        const candidates = [
            document.querySelector('.navbar-nav.ml-auto'),
            document.querySelector('.navbar-nav.mr-auto'),
            document.querySelector('ul.navbar-nav'),
            document.querySelector('.navbar'),
            document.getElementById('page-main-content'),
        ];

        const toolbar = candidates.find(Boolean);

        if (toolbar && toolbar.tagName === 'UL') {
            const li = document.createElement('li');
            li.className = 'nav-item';
            li.style.cssText = 'display:flex;align-items:center;padding:0 8px;';
            li.appendChild(panel);
            // Insert before the last item (support button) so we're near the right edge
            toolbar.insertBefore(li, toolbar.lastElementChild || null);
        } else if (toolbar) {
            panel.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:4px 12px;';
            toolbar.prepend(panel);
        } else {
            // Floating fallback
            const wrapper = document.createElement('div');
            wrapper.style.cssText = `
                position:fixed;top:66px;right:16px;z-index:99999;
                background:rgba(255,255,255,0.97);
                border:1px solid #dee2e6;border-radius:6px;
                padding:8px 12px;box-shadow:0 2px 10px rgba(0,0,0,0.15);
            `;
            wrapper.appendChild(panel);
            document.body.appendChild(wrapper);
        }

        // Ensure toast element exists
        if (!document.getElementById('mat-dl-toast')) {
            const toast = document.createElement('div');
            toast.id = 'mat-dl-toast';
            document.body.appendChild(toast);
        }

        console.log('[Matricula DL] ✓ Download button injected');
    }

    // ─── SPA navigation watcher ────────────────────────────────────────────────

    let _lastHref = location.href;

    new MutationObserver(() => {
        if (location.href === _lastHref) return;
        _lastHref = location.href;
        _capturedImageUrl = null;

        // Remove old panel (it may be wrapped in a <li>)
        const old = document.getElementById('mat-dl-panel');
        if (old) {
            const parent = old.parentElement;
            (parent?.tagName === 'LI' ? parent : old).remove();
        }

        setTimeout(injectUI, 800);
    }).observe(document.body, { childList: true, subtree: true });

    // ─── Bootstrap ────────────────────────────────────────────────────────────

    installNetworkInterceptor();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(injectUI, 600));
    } else {
        setTimeout(injectUI, 600);
    }

})();
