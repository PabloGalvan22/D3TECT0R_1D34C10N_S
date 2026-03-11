/**
 * SentinelCareAI — Cloudflare Worker Proxy
 * ─────────────────────────────────────────
 * Actúa como intermediario entre el frontend y la API de Groq.
 * La API key NUNCA llega al navegador — vive aquí como variable de entorno.
 *
 * ENDPOINTS:
 *   POST /chat        → Groq chat completions (Llama / Aura)
 *   POST /transcribe  → Groq Whisper transcription (voz)
 *
 * DESPLIEGUE:
 *   1. Instala Wrangler: npm install -g wrangler
 *   2. Inicia sesión:    wrangler login
 *   3. Agrega tu key:    wrangler secret put GROQ_API_KEY
 *      (pega la key cuando la pida — ej: gsk_xxxx...)
 *   4. Despliega:        wrangler deploy
 *   5. Copia la URL que te da Wrangler (ej: https://sentinel-proxy.TU-USUARIO.workers.dev)
 *   6. Pégala en SentinelAI_v26.html como valor de PROXY_BASE_URL
 *
 * CORS: Solo acepta peticiones desde los dominios listados en ALLOWED_ORIGINS.
 *       Agrega el tuyo si despliegas el HTML en un dominio propio.
 */

// ── Dominios autorizados a usar este proxy ────────────────
const ALLOWED_ORIGINS = [
  'http://localhost',
  'http://127.0.0.1',
  'null',                                          // file:// local (abrir el HTML directo)
  'https://pablogalvan22.github.io',               // GitHub Pages
];

const GROQ_CHAT_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// ── Helpers CORS ──────────────────────────────────────────
function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function jsonResponse(body, status = 200, origin = '*') {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function errorResponse(message, status, origin) {
  return jsonResponse({ error: { message } }, status, origin);
}

// ── Main handler ──────────────────────────────────────────
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || 'null';
    const url    = new URL(request.url);

    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // Solo POST
    if (request.method !== 'POST') {
      return errorResponse('Método no permitido', 405, origin);
    }

    // Verificar que la API key está configurada
    if (!env.GROQ_API_KEY) {
      console.error('GROQ_API_KEY secret not set');
      return errorResponse('Proxy mal configurado — falta GROQ_API_KEY', 500, origin);
    }

    const authHeader = { 'Authorization': 'Bearer ' + env.GROQ_API_KEY };

    // ── /chat — reenvía a Groq chat completions ──────────
    if (url.pathname === '/chat') {
      let body;
      try {
        body = await request.json();
      } catch {
        return errorResponse('JSON inválido', 400, origin);
      }

      const groqRes = await fetch(GROQ_CHAT_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify(body),
      });

      const data = await groqRes.json();
      return jsonResponse(data, groqRes.status, origin);
    }

    // ── /transcribe — reenvía a Groq Whisper ─────────────
    if (url.pathname === '/transcribe') {
      let formData;
      try {
        formData = await request.formData();
      } catch {
        return errorResponse('FormData inválido', 400, origin);
      }

      const groqRes = await fetch(GROQ_TRANSCRIBE_URL, {
        method:  'POST',
        headers: authHeader,   // Content-Type lo pone el browser automáticamente con el boundary
        body:    formData,
      });

      const data = await groqRes.json();
      return jsonResponse(data, groqRes.status, origin);
    }

    // Ruta no encontrada
    return errorResponse('Ruta no encontrada. Usa /chat o /transcribe', 404, origin);
  },
};
