/**
 * 可选：把 vendor/pets 下的每种宠物打成 zip。
 * 安装包不再携带这些 zip，用户从 77-pet-packs 按需下载。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listPetPackNames } from './pet-packs.mjs';
import { zipDirectory } from './zip-pack.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = path.join(root, 'vendor', 'pet-packs');

const names = listPetPackNames(root);
if (names.length === 0) {
  console.log('[77-pet] 没有可打包的宠物');
} else {
  for (const name of names) {
    const dest = path.join(outDir, name + '.zip');
    await zipDirectory(path.join(root, 'vendor', 'pets', name), dest);
    console.log('[77-pet] 宠物包 ' + dest);
  }
}
