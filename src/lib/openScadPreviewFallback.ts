import { isOpenScadOutputLimitError } from './openScadLimits';

/** Only the interactive preview may lose colors: export and source-aware probes stay strict. */
export async function requestPreviewWithOutputFallback<T>(
  request: (includeColorData: boolean | undefined) => Promise<T>,
  includeColorData: boolean | undefined,
  isCurrent: () => boolean,
): Promise<{ response: T; usedFallback: boolean }> {
  try {
    return { response: await request(includeColorData), usedFallback: false };
  } catch (error) {
    if (includeColorData === false || !isOpenScadOutputLimitError(error) || !isCurrent()) {
      throw error;
    }
    return { response: await request(false), usedFallback: true };
  }
}
