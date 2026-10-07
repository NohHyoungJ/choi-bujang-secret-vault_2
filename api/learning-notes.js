import { createClient } from '@supabase/supabase-js';

function sendError(response, status, code) {
  return response.status(status).json({ error: code });
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return sendError(response, 405, 'METHOD_NOT_ALLOWED');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return sendError(response, 503, 'SERVER_CONFIGURATION_MISSING');
  }

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
