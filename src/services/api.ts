import { supabase } from '@/lib/supabase';
import { z } from 'zod';

const API_PATH_ALIASES: Record<string, string> = {
  // ProvidersSettings historically used kebab-case while the TanStack route
  // is generated from runtimeIntegrations.ts and therefore uses camelCase.
  'settings/runtime-integrations': 'settings/runtimeIntegrations',
};

export function apiUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const resolvedPath = API_PATH_ALIASES[path] ?? path;
  return `${basePath}/api/${resolvedPath}`;
}

export async function apiJson(
  path: string,
  init?: RequestInit,
): Promise<unknown>;
export async function apiJson<T>(
  path: string,
  init: RequestInit,
  schema: z.ZodType<T>,
): Promise<T>;
export async function apiJson<T>(
  path: string,
  init: RequestInit = {},
  schema?: z.ZodType<T>,
): Promise<T | unknown> {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const url = apiUrl(path);
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const contentType = response.headers.get('Content-Type') ?? '';
  if (!contentType.includes('application/json')) {
    const preview = (await response.text()).slice(0, 160);
    throw new Error(`Unexpected API response from ${url}: ${preview}`);
  }
  const data: unknown = await response.json();
  if (!response.ok) {
    const errorValue =
      typeof data === 'object' && data !== null
        ? Reflect.get(data, 'error')
        : undefined;
    throw new Error(
      typeof errorValue === 'string' ? errorValue : response.statusText,
    );
  }
  return schema ? schema.parse(data) : data;
}
