import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'browser-extension');
const output = path.join(source, 'dist');
const petAssets = path.join(
  root,
  'harmony/verify-float-pet/entry/src/main/resources/rawfile/pet'
);
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

rmSync(output, { recursive: true, force: true });
mkdirSync(path.join(output, 'icons'), { recursive: true });
mkdirSync(path.join(output, 'assets/pet'), { recursive: true });

for (const file of ['background.js', 'content.js', 'popup.html', 'popup.css', 'popup.js']) {
  cpSync(path.join(source, file), path.join(output, file));
}
cpSync(path.join(source, 'icons'), path.join(output, 'icons'), { recursive: true });
cpSync(
  path.join(petAssets, 'packs.json'),
  path.join(output, 'assets/pet/packs.json')
);
cpSync(
  path.join(source, 'frame-bounds.json'),
  path.join(output, 'assets/pet/frame-bounds.json')
);
cpSync(path.join(petAssets, 'packs'), path.join(output, 'assets/pet/packs'), {
  recursive: true
});

const manifest = JSON.parse(readFileSync(path.join(source, 'manifest.json'), 'utf8'));
manifest.version = packageJson.version;
writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n'
);

console.log('→ browser-extension/dist');
console.log('  版本 ' + manifest.version + '，已打包宠物素材');
