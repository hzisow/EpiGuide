#!/usr/bin/env node
/**
 * sync-www.mjs — copy the repo's static web assets into www/ for Capacitor.
 *
 * This repo has no build step: index.html, css/, js/, icons/, media/, etc. all
 * live at the repo root and are served as-is (GitHub Pages). Capacitor needs a
 * single `webDir`, so this script mirrors the root into www/ and skips the
 * things that are tooling rather than app assets.
 *
 * Plain node, zero dependencies. Run via `npm run build`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WWW = path.join(ROOT, 'www');

/** Top-level entries that are tooling/output, not web assets. */
const EXCLUDE = new Set([
  'node_modules',
  'ios',
  'android',
  'www',
  'scripts',
  // Server-side only: SQL migrations and Edge Function source. Never belongs in
  // the app bundle or on the public Pages site.
  'supabase',
  'capacitor.config.json',
]);

/** Assets that must exist in www/ afterwards, or the build is broken. */
const REQUIRED = [
  'index.html',
  'manifest.json',
  'sw.js',
  'js/app.js',
  'js/config.js',
  'js/vendor/tesseract',
  'css/tokens.css',
  'icons/icon-512.png',
];

function isExcluded(name) {
  // Dotfiles are repo/CI plumbing (.git, .gitattributes, .nojekyll,
  // .deploy-stamp, .DS_Store) — never app assets.
  if (name.startsWith('.')) return true;
  if (EXCLUDE.has(name)) return true;
  // package.json / package-lock.json, and all markdown docs.
  if (/^package(-lock)?\.json$/.test(name)) return true;
  if (/\.md$/i.test(name)) return true;
  return false;
}

let fileCount = 0;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    // Only the top level is filtered; nested trees copy wholesale so that
    // e.g. js/vendor/tesseract/tessdata comes along intact.
    if (src === ROOT && isExcluded(entry.name)) continue;
    if (entry.name === '.DS_Store') continue;

    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(from), to);
      fileCount++;
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      fileCount++;
    }
  }
}

fs.rmSync(WWW, { recursive: true, force: true });
copyDir(ROOT, WWW);

const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(WWW, rel)));
if (missing.length) {
  console.error(`sync-www: missing expected asset(s) in www/:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

console.log(`sync-www: copied ${fileCount} files into www/`);
