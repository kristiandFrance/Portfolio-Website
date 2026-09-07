// @ts-check
import { defineConfig } from 'astro/config';

/**
 * Custom domain: kristiandfrance.com (GitHub Pages serves it at the root,
 * so `base` is '/' even though this deploys from a project repo).
 *
 * public/CNAME carries the domain for Pages. If you ever need to preview
 * from the raw github.io URL, set PAGES_BASE=/Portfolio-Website/ in the
 * build environment.
 */
const site = process.env.PAGES_SITE ?? 'https://kristiandfrance.com';
const base = process.env.PAGES_BASE ?? '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
