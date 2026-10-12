import { readFile, mkdir, writeFile } from 'node:fs/promises';

const [html, css, script] = await Promise.all(
  ['index.html', 'style.css', 'entry.mjs'].map(file => readFile(new URL(file, import.meta.url), 'utf8')),
);
const output = html
  .replace('<link rel="stylesheet" href="./style.css">', `<style>${css}</style>`)
  .replace('<script type="module" src="./entry.mjs"></script>', `<script type="module">${script}</script>`);
const directory = new URL('./dist/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('index.html', directory), output);
console.log('Built entry-page/dist/index.html (standalone, no external dependencies)');
