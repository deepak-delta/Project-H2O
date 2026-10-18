import { isNative } from '../native/platform';

/** Saves a file made on the phone (CSV, PDF) through the browser's normal download. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (isNative()) {
    // The app's WebView can't download; it shares the file instead (loaded only in the app).
    void import('../native/files').then(({ shareFile }) => shareFile(filename, blob));
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
