import { supabase } from '@/lib/supabase';
import type { BrepParameterValues } from '@shared/brepProvider';
import type { BrepProject } from '@shared/brepProject';
import { apiUrl } from './api';

async function exportBrepNativeArtifact(
  project: BrepProject,
  parameterValues: BrepParameterValues,
  format: 'step' | '3dm',
): Promise<Blob> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const response = await fetch(apiUrl('brep/export/step'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: format === '3dm' ? 'model/vnd.3dm' : 'model/step',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ project, parameterValues }),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : `BRep ${format.toUpperCase()} export failed (${response.status}).`;
    throw new Error(message);
  }
  return response.blob();
}

export function exportBrepStep(
  project: BrepProject,
  parameterValues: BrepParameterValues,
): Promise<Blob> {
  return exportBrepNativeArtifact(project, parameterValues, 'step');
}

export function exportBrep3dm(
  project: BrepProject,
  parameterValues: BrepParameterValues,
): Promise<Blob> {
  return exportBrepNativeArtifact(project, parameterValues, '3dm');
}
