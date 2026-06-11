// Rasterise the SVG sources in public/ into the PNG icons the favicon, the PWA
// manifest, and iOS home-screen need. Run with `pnpm gen:icons` whenever the
// source SVGs change; the generated PNGs are committed so the build needs no
// rasteriser. Uses @resvg/resvg-js (prebuilt native bindings).
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pub = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

function render(svgFile, size, outName) {
  const svg = readFileSync(resolve(pub, svgFile), 'utf8');
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(pub, outName), png);
  console.log(`  ${outName.padEnd(22)} ${size}px  ${(png.length / 1024).toFixed(1)} kB`);
}

console.log('Generating icons from public/*.svg …');
render('icon.svg', 192, 'pwa-192.png');
render('icon.svg', 512, 'pwa-512.png');
render('icon.svg', 180, 'apple-touch-icon.png');
render('icon.svg', 32, 'favicon-32.png');
render('icon-maskable.svg', 512, 'maskable-512.png');
console.log('Done.');
