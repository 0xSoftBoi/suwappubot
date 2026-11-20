/**
 * How an admin-dashboard request authenticates. One definition, used by every
 * section, so a section cannot drift into sending the wrong credential.
 */

/** Sentinel "key" meaning: authenticate with the signed-in Google session
 *  cookie instead of an X-Admin-Key header (api-ts adminSessionAuth.ts). */
export const SESSION_AUTH = '@session';

/** fetch() options for an admin API call made with `key`. The session path
 *  must NOT send X-Admin-Key: the server treats any request carrying that
 *  header as key auth and never falls back to the session. */
export function adminRequestInit(key: string): RequestInit {
  return key === SESSION_AUTH ? { credentials: 'include' } : { headers: { 'X-Admin-Key': key } };
}
