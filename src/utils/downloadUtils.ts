// Download helpers for browser-local OpenSCAD files.
// No AI conversation, STEP, Rhino or BREP export paths are supported.

export type DxfExporter = () => Promise<Blob>;

interface DownloadOptions {
  content: Blob | string;
  filename: string;
  mimeType?: string;
}

export function downloadFile({
  content,
  filename,
  mimeType = 'application/octet-stream',
}: DownloadOptions): void {
  const blob = typeof content === 'string'
    ? new Blob([content], { type: mimeType })
    : content;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
