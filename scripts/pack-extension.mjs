// Zips extension/ into public/ so the clipper settings page can offer it as a
// download. Runs in the build, so the zip always matches the deployed commit.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = join(root, 'extension');
const FOLDER = 'kove-extension';

const zip = new PizZip();
for (const entry of readdirSync(source, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || entry.name === '.DS_Store') continue;
  const file = join(entry.parentPath ?? entry.path, entry.name);
  zip.file(`${FOLDER}/${relative(source, file).split('\\').join('/')}`, readFileSync(file));
}

const out = join(root, 'public', `${FOLDER}.zip`);
writeFileSync(out, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(`Packed ${Object.keys(zip.files).filter((f) => !f.endsWith('/')).length} files into ${relative(root, out)}`);
