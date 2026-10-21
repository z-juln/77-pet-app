/**
 * 用户层桌宠列表（名字、大小、位置、显示方式），存 ~/.dsh-pet-app/pets.json
 */

export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

export const CORNER_LABEL = {
  'top-left': '左上角',
  'top-right': '右上角',
  'bottom-left': '左下角',
  'bottom-right': '右下角',
};

const DISPLAY_VALUES = ['web', 'desktop', 'both', 'none'];

/**
 * @param {unknown} pet
 * @param {Record<string, object>} [baseById]
 */
export function normalizeUserPet(pet, baseById = {}) {
  const base = baseById[pet?.id] ?? {};
  const position = { ...(base.position ?? {}), ...(pet?.position ?? {}) };
  const corner = CORNERS.includes(position.corner) ? position.corner : 'top-right';
  const size = Number(pet?.size ?? base.size ?? 462);
  const displayRaw = pet?.display ?? base.display ?? 'both';
  const display = DISPLAY_VALUES.includes(displayRaw) ? displayRaw : 'both';
  const id = String(pet?.id ?? base.id ?? '').trim();
  return {
    id,
    name: String(pet?.name ?? base.name ?? id).trim() || id,
    size: Number.isFinite(size) && size > 0 ? Math.round(size) : 462,
    display,
    balanceEnabled: pet?.balanceEnabled ?? base.balanceEnabled ?? true,
    whisperEnabled: pet?.whisperEnabled ?? base.whisperEnabled ?? true,
    whisperUseModel:
      pet?.whisperUseModel === undefined
        ? base.whisperUseModel !== false
        : pet.whisperUseModel !== false,
    workStatusEnabled: pet?.workStatusEnabled ?? base.workStatusEnabled ?? true,
    fixedEnabled: pet?.fixedEnabled ?? base.fixedEnabled ?? false,
    pack: typeof pet?.pack === 'string' && pet.pack.trim() ? pet.pack.trim() : base.pack || '',
    position: {
      corner,
      marginX: Number.isFinite(Number(position.marginX)) ? Math.round(Number(position.marginX)) : 24,
      marginY: Number.isFinite(Number(position.marginY)) ? Math.round(Number(position.marginY)) : 250,
    },
  };
}

/**
 * @param {object} baseConfig
 * @param {Array<object>} userPets
 */
export function mergePetsIntoConfig(baseConfig, userPets) {
  const basePets = Array.isArray(baseConfig.pets) ? baseConfig.pets : [];
  const baseById = Object.fromEntries(basePets.map((pet) => [pet.id, pet]));
  const merged = userPets.map((pet) => {
    const normalized = normalizeUserPet(pet, baseById);
    const base = baseById[normalized.id] ?? basePets[0] ?? {};
    return {
      ...base,
      ...normalized,
      position: { ...(base.position ?? {}), ...normalized.position },
    };
  });
  return { ...baseConfig, pets: merged.length > 0 ? merged : basePets };
}

/**
 * @param {Array<object>} pets
 */
export function validateUserPets(pets) {
  if (!Array.isArray(pets) || pets.length === 0) {
    throw new Error('至少保留一只桌宠');
  }
  const ids = new Set();
  for (const pet of pets) {
    const id = String(pet?.id ?? '').trim();
    if (!id) throw new Error('宠物 id 不能为空');
    if (ids.has(id)) throw new Error('宠物 id 不能重复：' + id);
    ids.add(id);
    const size = Number(pet.size);
    if (!Number.isFinite(size) || size < 120 || size > 1200) {
      throw new Error('大小需在 120–1200 px 之间');
    }
    if (!CORNERS.includes(pet?.position?.corner)) {
      throw new Error('位置无效');
    }
  }
}

/**
 * @param {object} template
 * @param {Array<object>} existing
 */
export function createPetFromTemplate(template, existing) {
  const base = normalizeUserPet(template, { [template.id]: template });
  let index = existing.length + 1;
  let id = 'pet' + index;
  while (existing.some((pet) => pet.id === id)) {
    index += 1;
    id = 'pet' + index;
  }
  return {
    ...base,
    id,
    name: (base.name || '桌宠') + ' ' + index,
    display: 'desktop',
    whisperUseModel: true,
  };
}
