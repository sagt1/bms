import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { isAllowedSupabaseUrl, isBrowserSafeSupabaseKey, SAGT_VERIFY_PROJECT_REF } from './project-boundary';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
const isPlaceholderKey = !key || /placeholder|replace_with|your_(anon|publishable)_key/i.test(key);
const isExpectedProject = isAllowedSupabaseUrl(url);
const isSafeBrowserKey = !isPlaceholderKey && isBrowserSafeSupabaseKey(key);

export const supabase = isExpectedProject && isSafeBrowserKey
  ? createClient<Database>(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export const configError = !url
  ? 'Supabase configuration is missing. Copy .env.example to .env.local and set the existing project URL and browser-safe key.'
  : !isExpectedProject
    ? `This app is restricted to the SAGT - Verify Supabase project (${SAGT_VERIFY_PROJECT_REF}). Check VITE_SUPABASE_URL.`
    : isPlaceholderKey
      ? 'Set VITE_SUPABASE_PUBLISHABLE_KEY in .env.local to the existing project’s publishable key.'
      : !isSafeBrowserKey
        ? 'Use the browser-safe publishable key or the legacy anon key. Secret and service-role keys are blocked.'
        : '';
