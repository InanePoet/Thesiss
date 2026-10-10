import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNative = () => Capacitor.isNativePlatform();

export const BASE_DIR = 'Thesiss';

export function openUrl(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  if (!isNative()) a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/**
 * Salva un file esportato. Su Android lo scrive in Documenti/Thesiss/esportazioni e apre la condivisione;
 * nel browser lo scarica.
 */
export async function saveExport(name: string, data: Blob | string, mime: string, share = true): Promise<string> {
  if (!isNative()) {
    const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'Download';
  }
  const path = `${BASE_DIR}/esportazioni/${name}`;
  let dir = Directory.Documents;
  try {
    if (typeof data === 'string') await Filesystem.writeFile({ path, data, directory: dir, encoding: Encoding.UTF8, recursive: true });
    else await Filesystem.writeFile({ path, data: await blobToBase64(data), directory: dir, recursive: true });
  } catch {
    dir = Directory.External;
    if (typeof data === 'string') await Filesystem.writeFile({ path, data, directory: dir, encoding: Encoding.UTF8, recursive: true });
    else await Filesystem.writeFile({ path, data: await blobToBase64(data), directory: dir, recursive: true });
  }
  if (share) {
    try {
      const { uri } = await Filesystem.getUri({ path, directory: dir });
      await Share.share({ title: name, url: uri, dialogTitle: 'Condividi o salva' });
    } catch { /* condivisione annullata */ }
  }
  return dir === Directory.Documents ? `Documenti/${path}` : `memoria dell'app/${path}`;
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = () => res(i.files?.[0] || null);
    i.addEventListener('cancel', () => res(null));
    i.click();
  });
}

export async function writeText(path: string, text: string, directory: Directory) {
  await Filesystem.writeFile({ path, data: text, directory, encoding: Encoding.UTF8, recursive: true });
}

export { Directory, Filesystem, Encoding };
