// ==UserScript==
// @name         Matricula Online – Bild-Downloader
// @namespace    https://data.matricula-online.eu/
// @version      2.2.0
// @description  Fügt einen Download-Button in den Matricula-Viewer ein und lädt die eigentliche hochauflösende Buchseite herunter (nicht das Logo).
// @author       Jesper Mahel
// @match        https://data.matricula-online.eu/*
// @match        https://*.matricula-online.eu/*
// @connect      *
// @grant        GM_download
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    // ─── Styling ───────────────────────────────────────────────────────────────

    function injectStyles() {
        const css = `
            #mat-dl-panel {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-left: 8px;
                margin-right: 8px;
            }
            #mat-dl-btn, #mat-dl-open-btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 5px 12px;
                font-size: 13px;
                font-weight: 600;
                border-radius: 4px;
                cursor: pointer;
                user-select: none;
                font-family: inherit;
                line-height: 1.5;
            }
            #mat-dl-btn {
                color: #fff;
                background: #007bff;
                border: 1px solid #0069d9;
                transition: background 0.15s ease, box-shadow 0.15s ease;
            }
            #mat-dl-btn:hover {
                background: #0069d9;
                box-shadow: 0 2px 6px rgba(0,0,0,0.2);
            }
            #mat-dl-btn:active {
                background: #0056b3;
            }
            #mat-dl-btn:disabled {
                opacity: 0.65;
                cursor: wait;
            }
            #mat-dl-open-btn {
                color: #007bff;
                background: #fff;
                border: 1px solid #007bff;
                transition: background 0.15s ease;
            }
            #mat-dl-open-btn:hover {
                background: rgba(0,123,255,0.1);
            }
            #mat-dl-toast {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 9999999;
                padding: 10px 18px;
                border-radius: 6px;
                font-size: 14px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                color: #fff;
                background: #333;
                box-shadow: 0 4px 16px rgba(0,0,0,0.3);
                opacity: 0;
                transform: translateY(10px);
                transition: opacity 0.25s ease, transform 0.25s ease;
                pointer-events: none;
            }
            #mat-dl-toast.show { opacity: 1; transform: translateY(0); }
            #mat-dl-toast.ok   { background: #28a745; }
            #mat-dl-toast.err  { background: #dc3545; }
            #mat-dl-toast.info { background: #007bff; }
        `;
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
        } else {
            const style = document.createElement('style');
            style.textContent = css;
            (document.head || document.documentElement).appendChild(style);
        }
    }

    // ─── Toast Helper ──────────────────────────────────────────────────────────

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

    // ─── URL Detection & Matching ──────────────────────────────────────────────

    const IMG_PROXY_REGEX = /img\.data\.matricula-online\.eu\/image\//i;
    const IMG_HOSTED_REGEX = /hosted-images\.matricula-online\.eu\/images\//i;

    function isBookImageUrl(url) {
        if (!url || typeof url !== 'string') return false;
        // Never treat logos / static icons as church register images
        if (/logo|favicon|static|spinner|loading/i.test(url)) return false;
        return IMG_PROXY_REGEX.test(url) || IMG_HOSTED_REGEX.test(url);
    }

    function decodeInternalUrl(proxyUrl) {
        if (!proxyUrl) return null;
        const m = proxyUrl.match(/\/image\/([^/?#]+)/);
        if (!m) return null;
        try {
            const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
            return atob(b64);
        } catch (_) {
            return null;
        }
    }

    function buildFilename(url) {
        const decoded = decodeInternalUrl(url);
        if (decoded) {
            const parts = decoded.split('/');
            const name = parts[parts.length - 1];
            if (name && /\.jpe?g$/i.test(name)) {
                return name;
            }
        }
        const path = location.pathname.replace(/^\/[a-z]{2}\//, '').replace(/\/$/, '').replace(/\//g, '_');
        const pg = new URLSearchParams(location.search).get('pg') || '1';
        return `${path || 'matricula'}_pg${String(pg).padStart(3, '0')}.jpg`;
    }

    let capturedProxyUrl = null;

    // ─── Interceptors (runs at document-start) ──────────────────────────────────

    function recordUrl(url) {
        if (isBookImageUrl(url)) {
            capturedProxyUrl = url;
            console.log('[Matricula-DL] Captured image URL:', url);
        }
    }

    try {
        // 1. Hook Image.prototype.src on page window
        const imgProto = win.HTMLImageElement ? win.HTMLImageElement.prototype : HTMLImageElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(imgProto, 'src');
        if (desc && desc.set) {
            const origSet = desc.set;
            Object.defineProperty(imgProto, 'src', {
                set(v) {
                    recordUrl(v);
                    origSet.call(this, v);
                },
                get: desc.get,
                configurable: true,
            });
        }

        // 2. Hook fetch on page window
        const origFetch = win.fetch;
        if (origFetch) {
            win.fetch = function (...args) {
                const u = typeof args[0] === 'string' ? args[0] : args[0]?.url;
                recordUrl(u);
                return origFetch.apply(this, args);
            };
        }

        // 3. Hook XMLHttpRequest on page window
        const origOpen = win.XMLHttpRequest ? win.XMLHttpRequest.prototype.open : null;
        if (origOpen) {
            win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
                recordUrl(url);
                return origOpen.call(this, method, url, ...rest);
            };
        }
    } catch (e) {
        console.warn('[Matricula-DL] Interceptor hook warning:', e);
    }

    // ─── Fallback Strategies ───────────────────────────────────────────────────

    function findInPerformance() {
        try {
            const entries = (win.performance || performance).getEntriesByType('resource');
            for (let i = entries.length - 1; i >= 0; i--) {
                const u = entries[i].name;
                if (isBookImageUrl(u)) {
                    return u;
                }
            }
        } catch (_) {}
        return null;
    }

    function findInScripts() {
        const re = /(https?:\/\/img\.data\.matricula-online\.eu\/image\/[A-Za-z0-9+/=_-]+(?:\?[^"'\s]*)?)/i;
        for (const s of document.querySelectorAll('script:not([src])')) {
            const m = (s.textContent || '').match(re);
            if (m && isBookImageUrl(m[1])) return m[1];
        }
        return null;
    }

    function findInDOM() {
        for (const el of document.querySelectorAll('[data-image-url],[data-src],[data-url]')) {
            const u = el.dataset.imageUrl || el.dataset.src || el.dataset.url;
            if (isBookImageUrl(u)) return u;
        }
        for (const img of document.querySelectorAll('img')) {
            const u = img.src;
            if (isBookImageUrl(u)) return u;
        }
        return null;
    }

    function getImageUrl() {
        // Priority 1: Performance timeline (most accurate for active page)
        const fromPerf = findInPerformance();
        if (fromPerf) return fromPerf;

        // Priority 2: Actively captured URL
        if (capturedProxyUrl) return capturedProxyUrl;

        // Priority 3: Inline scripts
        const fromScript = findInScripts();
        if (fromScript) return fromScript;

        // Priority 4: DOM
        const fromDom = findInDOM();
        if (fromDom) return fromDom;

        return null;
    }

    // ─── Actions ───────────────────────────────────────────────────────────────

    function doDownload() {
        const url = getImageUrl();
        if (!url) {
            toast('⚠️ Keine Buchseite gefunden – bitte warten bis das Bild geladen ist.', 'err', 5000);
            return;
        }

        const filename = buildFilename(url);
        const btn = document.getElementById('mat-dl-btn');
        if (btn) btn.disabled = true;

        console.log('[Matricula-DL] Starting download:', url, '->', filename);

        if (typeof GM_download === 'function') {
            GM_download({
                url,
                name: filename,
                saveAs: false,
                onload: () => {
                    if (btn) btn.disabled = false;
                    toast(`✅ Gespeichert: ${filename}`, 'ok');
                },
                onerror: (e) => {
                    if (btn) btn.disabled = false;
                    console.warn('[Matricula-DL] GM_download error, fallback to new tab:', e);
                    window.open(url, '_blank');
                    toast('⬇ Im neuen Tab geöffnet (Rechtsklick -> Speichern)', 'info', 5000);
                }
            });
        } else {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.target = '_blank';
            document.body.appendChild(a);
            a.click();
            a.remove();
            if (btn) btn.disabled = false;
            toast('⬇ Download gestartet', 'info');
        }
    }

    function doOpen() {
        const url = getImageUrl();
        if (!url) {
            toast('⚠️ Keine Buchseite gefunden.', 'err');
            return;
        }
        window.open(url, '_blank');
    }

    // ─── UI Creation & Placement ───────────────────────────────────────────────

    const SVG_DL = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-6-6h4V4h4v6h4l-6 6z"/><path d="M20 18H4v2h16v-2z"/></svg>`;
    const SVG_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M14 3v2H5v14h14v-9h2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9zM21 3v6h-2V6.41l-7.29 7.3-1.42-1.42L17.59 5H15V3h6z"/></svg>`;

    function isViewerPage() {
        const parts = location.pathname.split('/').filter(Boolean);
        return parts.length >= 5 || location.search.includes('pg=') || location.search.includes('page=');
    }

    function injectUI() {
        if (document.getElementById('mat-dl-panel')) return;
        if (!isViewerPage()) return;

        injectStyles();

        const panel = document.createElement('div');
        panel.id = 'mat-dl-panel';

        const dl = document.createElement('button');
        dl.id = 'mat-dl-btn';
        dl.type = 'button';
        dl.title = 'Aktuelle Buchseite herunterladen';
        dl.innerHTML = `${SVG_DL} Seite herunterladen`;
        dl.addEventListener('click', doDownload);

        const open = document.createElement('button');
        open.id = 'mat-dl-open-btn';
        open.type = 'button';
        open.title = 'Direkten Bildlink im neuen Tab öffnen';
        open.innerHTML = SVG_OPEN;
        open.addEventListener('click', doOpen);

        panel.appendChild(dl);
        panel.appendChild(open);

        const targets = [
            document.querySelector('.navbar-nav.ml-auto'),
            document.querySelector('ul.navbar-nav'),
            document.querySelector('.navbar'),
        ];
        const toolbar = targets.find(Boolean);

        if (toolbar && toolbar.tagName === 'UL') {
            const li = document.createElement('li');
            li.className = 'nav-item';
            li.style.cssText = 'display:flex;align-items:center;padding:0 8px;';
            li.appendChild(panel);
            toolbar.insertBefore(li, toolbar.lastElementChild);
        } else if (toolbar) {
            toolbar.prepend(panel);
        } else {
            const wrap = document.createElement('div');
            wrap.style.cssText = `position:fixed;top:66px;right:16px;z-index:99999;background:#fff;border:1px solid #dee2e6;border-radius:6px;padding:8px 12px;box-shadow:0 2px 10px rgba(0,0,0,.15);`;
            wrap.appendChild(panel);
            document.body.appendChild(wrap);
        }

        if (!document.getElementById('mat-dl-toast')) {
            document.body.appendChild(Object.assign(document.createElement('div'), { id: 'mat-dl-toast' }));
        }

        console.log('[Matricula-DL] UI injected successfully.');
    }

    // ─── SPA Navigation Watcher ────────────────────────────────────────────────

    let lastHref = location.href;
    const observer = new MutationObserver(() => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            capturedProxyUrl = null;
            const old = document.getElementById('mat-dl-panel');
            if (old) (old.closest('li') || old).remove();
            setTimeout(injectUI, 500);
        }
    });

    // ─── Initialization ────────────────────────────────────────────────────────

    function init() {
        if (document.body) {
            observer.observe(document.body, { childList: true, subtree: true });
        }
        injectUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
