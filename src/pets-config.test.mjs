import assert from 'node:assert/strict';
import test from 'node:test';

import { createPetFromTemplate, mergePetsIntoConfig, normalizeUserPet, validateUserPets } from './pets-config.mjs';

const baseConfig = {
  pets: [
    {
      id: 'main',
      name: '蓝毛小女仆',
      size: 462,
      display: 'both',
      position: { corner: 'top-right', marginX: 24, marginY: 100 },
    },
  ],
};

test('用户宠物配置会合并进运行时 config', () => {
  const merged = mergePetsIntoConfig(baseConfig, [
    {
      id: 'main',
      name: '改名',
      size: 400,
      display: 'desktop',
      position: { corner: 'top-left', marginX: 10, marginY: 20 },
    },
  ]);
  assert.equal(merged.pets[0].name, '改名');
  assert.equal(merged.pets[0].size, 400);
  assert.equal(merged.pets[0].position.corner, 'top-left');
});

test('碎碎念默认调用模型，显式关闭才不调用', () => {
  assert.equal(normalizeUserPet({ id: 'main', name: 'a', size: 200 }).whisperUseModel, true);
  assert.equal(normalizeUserPet({ id: 'main', name: 'a', size: 200, whisperUseModel: false }).whisperUseModel, false);
});

test('添加宠物会生成不重复的 id', () => {
  const created = createPetFromTemplate(baseConfig.pets[0], baseConfig.pets);
  assert.equal(created.id, 'pet2');
  assert.match(created.name, /2$/);
});

test('校验拒绝空列表和非法大小', () => {
  assert.throws(() => validateUserPets([]), /至少保留一只/);
  assert.throws(
    () => validateUserPets([{ ...normalizeUserPet(baseConfig.pets[0]), size: 50 }]),
    /120–1200/,
  );
});
