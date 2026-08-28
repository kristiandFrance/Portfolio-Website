// @ts-check
import { defineConfig } from 'astro/config';

/**
 * Site/base are derived from the repository this deploys from, so the project
 * is portable between `kristiandFrance/Portfolio-Website` (project pages,
 * served under /Portfolio-Website/) and `kristiandFrance/kristiandFrance.github.io`
 * (user pages, served at the domain root). GITHUB_REPOSITORY is set by Actions.
 */
const repo = process.env.GITHUB_REPOSITORY; // e.g. "kristiandFrance/Portfolio-Website"
let site = 'https://kristiandfrance.github.io';
let base = '/';

if (repo) {
  const [owner, name] = repo.split('/');
  site = `https://${owner.toLowerCase()}.github.io`;
  base = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '/' : `/${name}/`;
}

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
  },
});
