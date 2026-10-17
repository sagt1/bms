export const SAGT_VERIFY_PROJECT_REF = 'gewvwdfolaaipkpbqpmr';

export function isAllowedSupabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === `${SAGT_VERIFY_PROJECT_REF}.supabase.co`
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function isBrowserSafeSupabaseKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  if (/^sb_secret_/i.test(value)) return false;

  const segments = value.split('.');
  if (segments.length !== 3) return false;

  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { role?: unknown };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}
