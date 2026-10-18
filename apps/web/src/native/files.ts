import { toast } from '../stores/toast';

/**
 * Inside the Android app, files made on the phone (reports, recovery codes) can't be saved with
 * a browser download: the WebView ignores it. Save the file to the app's cache and open the
 * share sheet instead, where the user picks Files, Drive, WhatsApp…
 */
export async function shareFile(filename: string, blob: Blob): Promise<void> {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  try {
    const { uri } = await Filesystem.writeFile({ path: filename, data: await toBase64(blob), directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri] });
  } catch (err) {
    // Closing the share sheet without choosing is not a failure.
    if (err instanceof Error && /cancel/i.test(err.message)) return;
    toast.error("Couldn't save the file. Please try again.");
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result.replace(/^data:[^,]*,/, '') : '');
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}
