// theme.js
// One palette for every surface: the popup, the options page, and what the
// content script draws on Gerrit and Jira pages (FAB, toast, dialogs, change list).
//
// The choice lives in chrome.storage.local under 'uiTheme':
//   'auto' (or unset) -> follow the browser (prefers-color-scheme)
//   'light' | 'dark'  -> forced

(function initTheme(root) {
  'use strict';

  // fill is the solid background behind white text (buttons, badges); accent is
  // for text, outlines and links, which in dark mode must be the lighter blue.
  const PALETTE = {
    light: {
      bg: '#f3f5f8', surface: '#ffffff', ink: '#1d2533', sub: '#5b6779', line: '#d9e0ea', soft: '#eef2f7', mute: '#9aa3b2',
      accent: '#1565c0', 'accent-soft': '#e6effa', fill: '#1565c0', 'fill-ink': '#ffffff',
      ok: '#2e7d32', 'ok-soft': '#e7f3e8', 'ok-fill': '#2e7d32',
      warn: '#a15c00', 'warn-soft': '#fdf1df', 'warn-fill': '#b26a00',
      err: '#b3261e', 'err-soft': '#fbe9e7', 'err-fill': '#c62828',
      shade: 'rgba(20, 30, 50, 0.16)', backdrop: 'rgba(15, 20, 30, 0.35)',
    },
    dark: {
      bg: '#12161d', surface: '#1b212b', ink: '#e4e9f1', sub: '#9aa6b8', line: '#2e3744', soft: '#222a35', mute: '#5f6979',
      accent: '#6ea8ff', 'accent-soft': '#1d2a3d', fill: '#2f6fd1', 'fill-ink': '#ffffff',
      ok: '#7cc581', 'ok-soft': '#1c2b1e', 'ok-fill': '#2e7d32',
      warn: '#f0b35e', 'warn-soft': '#2e2416', 'warn-fill': '#b26a00',
      err: '#f28b82', 'err-soft': '#2f1d1c', 'err-fill': '#c62828',
      shade: 'rgba(0, 0, 0, 0.5)', backdrop: 'rgba(0, 0, 0, 0.55)',
    },
  };
  const NAMES = Object.keys(PALETTE.light);
  const decl = (mode) => `${NAMES.map((k) => `--${k}: ${PALETTE[mode][k]};`).join(' ')} color-scheme: ${mode};`;

  const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  let pref = 'auto';
  const listeners = new Set();

  function resolved() {
    return pref === 'dark' || (pref === 'auto' && !!media?.matches) ? 'dark' : 'light';
  }

  function notify() {
    const mode = resolved();
    listeners.forEach((fn) => fn(mode));
  }

  function setPref(value) {
    pref = value === 'light' || value === 'dark' ? value : 'auto';
    notify();
  }

  // Elements on a host page carry the variables themselves, so the page's own
  // variables and color-scheme (Jira's dark theme, say) never reach them.
  function applyVars(el) {
    const mode = resolved();
    for (const k of NAMES) el.style.setProperty(`--${k}`, PALETTE[mode][k]);
    el.style.colorScheme = mode;
  }

  /**
   * Reads the stored choice and keeps it current (storage edits from options, and
   * the browser switching light/dark while on "auto"). `fn` runs now and on every change.
   * @param {(mode: 'light'|'dark') => void} fn
   */
  function watch(fn) {
    listeners.add(fn);
    fn(resolved());
  }

  // Extension pages: light on :root, dark when the browser is dark and nothing is
  // forced, and whatever data-theme says otherwise. The media query covers the
  // first paint before storage answers, so "auto" never flashes.
  function initPage() {
    const style = root.document.createElement('style');
    style.textContent = `:root{${decl('light')}}`
      + `@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${decl('dark')}}}`
      + `:root[data-theme="dark"]{${decl('dark')}}`;
    root.document.head.prepend(style);
    const sync = () => {
      const el = root.document.documentElement;
      if (pref === 'auto') delete el.dataset.theme;
      else el.dataset.theme = pref;
    };
    listeners.add(sync);
    // The stored choice may already be in (storage answered first).
    sync();
  }

  try {
    chrome.storage.local.get(['uiTheme'], (data) => setPref(data && data.uiTheme));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.uiTheme) setPref(changes.uiTheme.newValue);
    });
  } catch {
    // No extension context (a plain page): stay on "auto".
  }
  media?.addEventListener?.('change', () => { if (pref === 'auto') notify(); });

  root.Theme = { applyVars, watch, initPage, resolved };
  // <script src="theme.js" data-page> in an extension page's <head> themes the page
  // before its first paint (inline scripts are not allowed in extension pages).
  if (root.document?.currentScript?.hasAttribute('data-page')) initPage();
})(typeof self !== 'undefined' ? self : window);
