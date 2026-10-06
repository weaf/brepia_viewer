import type { User } from '@supabase/supabase-js';
import { getAccountAccess } from './accountAdmin';
import { getAnonSupabaseClient } from './supabaseClient';

export const corsHeaders = {
  // Brepia's browser client is same-origin. Do not grant arbitrary websites
  // access to bearer-token APIs. An explicitly configured origin may be
  // returned by preflight() for an approved external client.
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  Vary: 'Origin',
};

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

export function preflight({ request }: { request?: Request } = {}) {
  const headers = new Headers(corsHeaders);
  const requestedOrigin = request?.headers.get('Origin');
  const configuredOrigin = process.env.BREPIA_CORS_ORIGIN?.trim();
  if (configuredOrigin && requestedOrigin === configuredOrigin) {
    headers.set('Access-Control-Allow-Origin', configuredOrigin);
  }
  return new Response('ok', { headers });
}

export function methodNotAllowed() {
  return json({ error: 'method_not_allowed' }, 405);
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof Error && error.message === 'Unauthorized';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Authenticate the bearer token without applying Brepia account authorization. */
export async function authenticateUser(request: Request): Promise<User> {
  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: request.headers.get('Authorization') ?? '' },
    },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) throw new Error('Unauthorized');
  return data.user;
}

/**
 * Standard API guard. A valid Supabase session is not sufficient: Brepia account
 * access must also be active. This makes pending/disabled a server-side rule,
 * not merely a UI convention.
 */
export async function requireUser(request: Request): Promise<User> {
  const user = await authenticateUser(request);
  const access = await getAccountAccess(user);
  if (access.status !== 'active') throw new Error('Unauthorized');
  return user;
}
