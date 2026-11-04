import { mkdir, copyFile, readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docDir = resolve(root, 'src/vendor/documents');
const files = [
  ['node_modules/pdfjs-dist/legacy/build/pdf.min.mjs', 'src/vendor/documents/pdf.min.mjs'],
  ['node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'src/vendor/documents/pdf.worker.min.mjs'],
  ['node_modules/pdfjs-dist/LICENSE', 'src/vendor/documents/PDFJS-LICENSE'],
  ['node_modules/fflate/esm/browser.js', 'src/vendor/documents/fflate-browser.mjs'],
  ['node_modules/fflate/LICENSE', 'src/vendor/documents/FFLATE-LICENSE'],
];
/* Local-only PDF.js rendering data: CMaps (CJK text) + standard fonts.
   Served same-origin so no CDN fetch and no eval-based fallback is needed. */
const dirs = [
  ['node_modules/pdfjs-dist/cmaps', 'src/vendor/documents/cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'src/vendor/documents/standard_fonts'],
];
async function listFiles(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) {
      out.push(...await listFiles(full));
    } else out.push(full);
  }
  return out;
}
const check = process.argv.includes('--check');
await mkdir(docDir, { recursive: true });
for (const [source, target] of files) {
  if (check) {
    const [a, b] = await Promise.all([readFile(resolve(root, source)), readFile(resolve(root, target))]);
    if (!a.equals(b)) throw new Error('Vendored document asset differs: ' + target);
  } else await copyFile(resolve(root, source), resolve(root, target));
}
for (const [sourceDir, targetDir] of dirs) {
  const absSrc = resolve(root, sourceDir);
  const absDst = resolve(root, targetDir);
  const srcFiles = await listFiles(absSrc);
  if (!srcFiles.length) throw new Error('Nothing to vendor in ' + sourceDir);
  if (check) {
    const expected=new Set(srcFiles.map(full=>relative(absSrc,full)));
    const extras=(await listFiles(absDst)).map(full=>relative(absDst,full)).filter(name=>!expected.has(name));
    if(extras.length) throw new Error('Unexpected vendored document assets: '+extras.join(', '));
    for (const full of srcFiles) {
      const rel = relative(absSrc, full);
      const [a, b] = await Promise.all([readFile(full), readFile(join(absDst, rel))]);
      if (!a.equals(b)) throw new Error('Vendored document asset differs: ' + join(targetDir, rel));
    }
  } else {
    await mkdir(absDst, { recursive: true });
    for (const full of srcFiles) {
      const rel = relative(absSrc, full);
      const dest = join(absDst, rel);
      await mkdir(dirname(dest), { recursive: true });
      await copyFile(full, dest);
    }
  }
}
console.log('Local document rendering assets ' + (check ? 'match pinned packages' : 'copied with licences') + '.');
