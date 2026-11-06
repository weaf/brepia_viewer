/** Make uploaded and exported OpenSCAD filenames safe on disk. */
export function getSafeFilename(baseFilename: string, fallback?: string): string {
  const filename = baseFilename?.trim() ? baseFilename.trim() : fallback || 'file';
  return filename.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}
