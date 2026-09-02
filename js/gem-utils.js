import { toMatchKey } from './tag-normalization.js';

function buildGemDictionary(gems) {
  const dictionary = new Map();
  const put = (key, gem) => {
    if (key == null || gem == null) return;
    const value = String(key);
    if (!dictionary.has(value)) dictionary.set(value, gem);
  };

  (gems || []).forEach((gem) => {
    if (!gem || typeof gem !== 'object') return;
    put(gem.id, gem);
    const baseItem = gem.base_item && typeof gem.base_item === 'object' ? gem.base_item : null;
    if (baseItem) put(baseItem.id, gem);
    const displayName = baseItem?.display_name || gem.name || gem.skill_name || gem.support_name;
    if (displayName) {
      put(displayName, gem);
      put(String(displayName).toLowerCase(), gem);
      put(toMatchKey(displayName), gem);
    }
    if (gem.skill_name) put(String(gem.skill_name).toLowerCase(), gem);
    if (gem.support_name) put(String(gem.support_name).toLowerCase(), gem);
  });
  return dictionary;
}

function lookupGem(dictionary, raw) {
  if (!dictionary) return null;
  if (raw && typeof raw === 'object') return raw;
  const key = String(raw || '').trim();
  if (!key) return null;
  const lower = key.toLowerCase();
  const normalized = toMatchKey(key);
  const last = lower.includes('/') ? lower.split('/').pop() : lower;
  const compactLast = last.replace(/[^a-z0-9]+/g, '');
  for (const candidate of [key, lower, normalized, last, compactLast]) {
    const gem = dictionary.get?.(candidate);
    if (gem) return gem;
  }
  if (dictionary instanceof Map) {
    for (const gem of dictionary.values()) {
      const displayName = gem?.base_item?.display_name || gem?.name || gem?.skill_name || gem?.support_name;
      const normalizedDisplay = displayName ? toMatchKey(displayName) : '';
      if (normalizedDisplay === normalized || normalizedDisplay === compactLast) return gem;
    }
  }
  return null;
}

export { buildGemDictionary, lookupGem };
