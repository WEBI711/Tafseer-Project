/**
 * The editor token lives only in this browser (the server checks it per
 * request) — other clients are unaffected and stay read-only.
 */
const TOKEN_KEY = "tafseer.editorToken";

export function editorToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveEditorToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode — the token is re-asked next time */
  }
}
