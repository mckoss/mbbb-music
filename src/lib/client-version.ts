// Every browser-originated mutation carries the version of the JavaScript that
// initiated it. This lets server actions distinguish an omitted field in an old
// form from an intentional clear in the current schema.

export const CLIENT_VERSION_FIELD = '_clientVersion';
export const CLIENT_VERSION_HEADER = 'x-mbbb-client-version';

let runningClientVersion: string | null = null;

export function normalizeClientVersion(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim() : '';
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(candidate) ? candidate : null;
}

export function setClientVersion(value: string): void {
  runningClientVersion = normalizeClientVersion(value);
}

/** Add or update the hidden version field before a non-GET form is submitted. */
export function stampWriteForm(form: HTMLFormElement): void {
  if ((form.method || 'get').toLowerCase() === 'get') return;
  const existing = form.elements.namedItem(CLIENT_VERSION_FIELD);
  let input: HTMLInputElement;
  if (existing instanceof HTMLInputElement) {
    input = existing;
  } else {
    input = document.createElement('input');
    input.type = 'hidden';
    input.name = CLIENT_VERSION_FIELD;
    form.append(input);
  }
  input.value = runningClientVersion ?? 'unknown';
}

/** Fetch wrapper for POST/PUT/PATCH/DELETE calls made by the browser bundle. */
export function writeFetch(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set(CLIENT_VERSION_HEADER, runningClientVersion ?? 'unknown');
  return fetch(input, { ...init, headers });
}

/** Exact form-bundle version wins; the request-header version is a fallback. */
export function clientVersionFromForm(form: FormData, fallback: string | null): string | null {
  return normalizeClientVersion(form.get(CLIENT_VERSION_FIELD)) ?? fallback;
}
