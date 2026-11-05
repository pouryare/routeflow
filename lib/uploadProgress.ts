/** Photo upload with a % ring (owner, 2026-11-05): fetch cannot report upload progress, so the
 *  file goes up with XMLHttpRequest, whose `upload.onprogress` can. */

/** Whole percent sent, 0 to 100; unknown totals count as 0 until the end. Pure, so it is tested. */
export function uploadPercent(loaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, Math.round((loaded / total) * 100)));
}

/** POSTs `body` to `url`, calling `onPercent` as it goes. Resolves with the status and the JSON
 *  answer (null when it is not JSON); a network failure resolves with status 0. Never rejects. */
export function postWithProgress(url: string, body: FormData, onPercent: (p: number) => void): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => onPercent(uploadPercent(e.loaded, e.lengthComputable ? e.total : 0));
    xhr.onload = () => {
      let json: unknown = null;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      resolve({ status: xhr.status, json });
    };
    xhr.onerror = () => resolve({ status: 0, json: null });
    xhr.onabort = () => resolve({ status: 0, json: null });
    xhr.send(body);
  });
}
