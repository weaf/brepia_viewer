import type { AppUIMessage } from '@shared/chatAi';
import {
  getCreativeMeshModelDefinition,
  normalizeCreativeMeshModelId,
} from '@shared/creativeMeshModels';
import type { Model } from '@shared/types';

export type CreativeInputValidationIssue = {
  title: string;
  description: string;
};

export function getCreativeInputValidationIssue({
  conversationType,
  model,
  parts,
}: {
  conversationType: 'parametric' | 'creative';
  model: Model;
  parts: AppUIMessage['parts'];
}): CreativeInputValidationIssue | null {
  if (conversationType !== 'creative') return null;

  const normalizedModel = normalizeCreativeMeshModelId(model);
  const definition = normalizedModel
    ? getCreativeMeshModelDefinition(normalizedModel)
    : undefined;
  if (!definition) return null;

  const referenceImageCount = parts.filter(
    (part) => part.type === 'file' && part.mediaType.startsWith('image/'),
  ).length;

  if (
    definition.maxReferenceImages !== undefined &&
    referenceImageCount > definition.maxReferenceImages
  ) {
    const limit = definition.maxReferenceImages;
    return {
      title: 'Too many reference images',
      description: `${definition.name} currently supports ${limit === 1 ? 'one reference image' : `up to ${limit} reference images`} per generation. Remove the extra images and try again.`,
    };
  }

  if (!definition.requiresReferenceImage || referenceImageCount > 0) {
    return null;
  }

  return {
    title: 'Reference image required',
    description: `${definition.name} requires a reference image. Add an image or choose TRELLIS.2 for text-only generation.`,
  };
}
