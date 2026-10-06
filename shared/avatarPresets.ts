export const AVATAR_PRESETS = [
  { id: 'user', label: 'Classic' },
  { id: 'bot', label: 'Bot' },
  { id: 'cube', label: 'Cube' },
  { id: 'cpu', label: 'Compute' },
  { id: 'code', label: 'Code' },
  { id: 'sparkles', label: 'Creative' },
  { id: 'rocket', label: 'Rocket' },
  { id: 'wrench', label: 'Maker' },
] as const;

export type AvatarPresetId = (typeof AVATAR_PRESETS)[number]['id'];

const AVATAR_PRESET_IDS = new Set<string>(
  AVATAR_PRESETS.map((preset) => preset.id),
);

export function isAvatarPresetId(value: unknown): value is AvatarPresetId {
  return typeof value === 'string' && AVATAR_PRESET_IDS.has(value);
}
