import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

function sendError(response, status, code) {
  return response.status(status).json({ error: code });
}

// Create the verifier once per server instance. It needs the server-only secret key,
// so it is built lazily: a configuration problem becomes a 503 instead of a crash.
let verifier;
function getVerifier() {
  verifier ??= createLoginVerifier({ config, supabaseSecretKey: process.env.SUPABASE_SECRET_KEY });
  return verifier;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Vary', 'Authorization');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }

  // Only the Authorization header is read. A userId/role sent by the browser
  // (query, body, or other headers) is ignored; identity comes from the verified token.
  const denyLogin = () => {
    response.setHeader('WWW-Authenticate', 'Bearer');
    return sendError(response, 401, 'LOGIN_REQUIRED');
  };
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization) return denyLogin();

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return sendError(response, 503, 'SERVER_CONFIGURATION_MISSING');
  }

  // Verify the token before touching the database. Failure returns no notes.
  let login;
  try {
    login = await getVerifier()(authorization);
  } catch {
    return sendError(response, 503, 'SERVER_CONFIGURATION_INVALID');
  }
  if (!login) return denyLogin();

  try {
    const parsedUrl = new URL(supabaseUrl);
    if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password
        || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
      return sendError(response, 503, 'SERVER_CONFIGURATION_INVALID');
    }

    const supabase = createClient(parsedUrl.origin, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
    const { data, error } = await supabase
      .from('learning_notes')
      .select('title,content')
      .order('id', { ascending: true });

    if (error || !Array.isArray(data)
        || data.some(note => typeof note.title !== 'string' || typeof note.content !== 'string')) {
      return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
    }

    return response.status(200).json({
      notes: data.map(({ title, content }) => ({ title, content })),
    });
  } catch {
    // Never log or return the Supabase URL, key, or upstream error details.
    return sendError(response, 502, 'LEARNING_NOTES_UNAVAILABLE');
  }
}
