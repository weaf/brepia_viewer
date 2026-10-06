import {
  Bot,
  Box,
  Code2,
  Cpu,
  Rocket,
  Sparkles,
  UserRound,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { AvatarPresetId } from '@shared/avatarPresets';
import { cn } from '@/lib/utils';

const ICONS: Record<AvatarPresetId, LucideIcon> = {
  user: UserRound,
  bot: Bot,
  cube: Box,
  cpu: Cpu,
  code: Code2,
  sparkles: Sparkles,
  rocket: Rocket,
  wrench: Wrench,
};

export function AvatarPresetIcon({
  preset,
  className,
}: {
  preset: AvatarPresetId;
  className?: string;
}) {
  const Icon = ICONS[preset];
  return <Icon aria-hidden="true" className={cn('h-5 w-5', className)} />;
}
