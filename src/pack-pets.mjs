/**
 * 把 vendor/pets 下的每种宠物打成 zip，供安装包携带。
 * 安装或启动时再解压到用户目录，安装包里不再放一份散文件。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { listPetPackNames } from './pet-packs.mjs';
import { zipDirectory } from './zip-pack.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = path.join(root, 'vendor', 'pet-packs');

const names = listPetPackNames(root);
if (names.length === 0) {
  console.log('[dsh-pet] 没有可打包的宠物');
} else {
  for (const name of names) {
    const dest = path.join(outDir, name + '.zip');
    await zipDirectory(path.join(root, 'vendor', 'pets', name), dest);
    console.log('[dsh-pet] 宠物包 ' + dest);
  }
}
