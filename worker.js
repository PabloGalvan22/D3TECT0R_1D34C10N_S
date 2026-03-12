/**
 * SentinelCareAI — Cloudflare Worker Proxy
 * ─────────────────────────────────────────
 * Intermediario seguro entre el frontend y la API de Groq.
 * La API key NUNCA llega al navegador.
 *
 * ENDPOINTS:
 *   POST /chat        → Groq chat completions (Llama / Aura)
 *   POST /transcribe  → Groq Whisper transcription (voz)
 *
 * RATE LIMITING (en memoria, por IP):
 *   - Máx. 30 requests por minuto por IP  (ventana deslizante)
 *   - Máx. 500 requests por día  por IP
 *   Se resetea automáticamente al expirar la ventana.
 *   Nota: al ser en memoria, se resetea si el worker se reinicia.
 *   Para persistencia total se necesitaría Cloudflare KV (plan pago).
 */

// ── Dominios autorizados ──────────────────────────────────
const ALLOWED_ORIGINS = [
  'http://localhost', 
  'http://127.0.0.1:5500', // puerto común para live server, pero se permite cualquier puerto en localhost
  'http://127.0.0.1', 
  'null',                              // file:// local
  'https://pablogalvan22.github.io',   // GitHub Pages
];

const GROQ_CHAT_URL       = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

// ── Rate limit config ─────────────────────────────────────
const RL_WINDOW_MS   = 60 * 1000;   // ventana de 1 minuto
const RL_MAX_MINUTE  = 30;           // máx requests por minuto
const RL_MAX_DAY     = 500;          // máx requests por día
const RL_DAY_MS      = 24 * 3600 * 1000;

// Almacenamiento en memoria (vive mientras el worker esté activo)
// Map<ip, { minuteCount, minuteStart, dayCount, dayStart }>
const rateLimitStore = new Map();

function checkRateLimit(ip) {
  const now  = Date.now();
  let entry  = rateLimitStore.get(ip);

  if (!entry) {
    entry = { minuteCount: 0, minuteStart: now, dayCount: 0, dayStart: now };
    rateLimitStore.set(ip, entry);
  }

  // Reset ventana de minuto si expiró
  if (now - entry.minuteStart > RL_WINDOW_MS) {
    entry.minuteCount = 0;
    entry.minuteStart = now;
  }

  // Reset ventana de día si expiró
  if (now - entry.dayStart > RL_DAY_MS) {
    entry.dayCount = 0;
    entry.dayStart = now;
  }

  entry.minuteCount++;
  entry.dayCount++;

  // Limpiar IPs inactivas para no acumular memoria indefinidamente
  if (rateLimitStore.size > 5000) {
    for (const [key, val] of rateLimitStore) {
      if (now - val.minuteStart > RL_WINDOW_MS * 2) rateLimitStore.delete(key);
    }
  }

  if (entry.minuteCount > RL_MAX_MINUTE) {
    const retryAfter = Math.ceil((entry.minuteStart + RL_WINDOW_MS - now) / 1000);
    return { blocked: true, reason: `Demasiadas peticiones. Intenta de nuevo en ${retryAfter}s.`, retryAfter };
  }

  if (entry.dayCount > RL_MAX_DAY) {
    const retryAfter = Math.ceil((entry.dayStart + RL_DAY_MS - now) / 1000);
    return { blocked: true, reason: 'Límite diario alcanzado. Intenta mañana.', retryAfter };
  }

  return { blocked: false };
}

// ── Helpers CORS ──────────────────────────────────────────
function corsHeaders(origin) {
  // Si el origen no está en la lista autorizada no se devuelve ningún header
  // Access-Control-Allow-Origin. El navegador bloqueará la respuesta por CORS.
  // Nota: no lanzamos un error aquí — el worker responde normalmente, pero sin
  // el header CORS el navegador descartará la respuesta en dominios no autorizados.
  if (!ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',   // necesario para cachés correctas
  };
}

function jsonResponse(body, status = 200, origin = '*', extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...extra },
  });
}

function errorResponse(message, status, origin, extra = {}) {
  return jsonResponse({ error: { message } }, status, origin, extra);
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

    // API key configurada
    if (!env.GROQ_API_KEY) {
      console.error('GROQ_API_KEY secret not set');
      return errorResponse('Proxy mal configurado — falta GROQ_API_KEY', 500, origin);
    }

    // ── Rate limiting ─────────────────────────────────────
    const ip = request.headers.get('CF-Connecting-IP')
            || request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
            || 'unknown';

    const rl = checkRateLimit(ip);
    if (rl.blocked) {
      console.warn(`Rate limit hit: ${ip} — ${rl.reason}`);
      return errorResponse(rl.reason, 429, origin, {
        'Retry-After': String(rl.retryAfter),
      });
    }

    const authHeader = { 'Authorization': 'Bearer ' + env.GROQ_API_KEY };

    // ── /chat ─────────────────────────────────────────────
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

    // ── /transcribe ───────────────────────────────────────
    if (url.pathname === '/transcribe') {
      let formData;
      try {
        formData = await request.formData();
      } catch {
        return errorResponse('FormData inválido', 400, origin);
      }

      const groqRes = await fetch(GROQ_TRANSCRIBE_URL, {
        method:  'POST',
        headers: authHeader,
        body:    formData,
      });

      const data = await groqRes.json();
      return jsonResponse(data, groqRes.status, origin);
    }

    return errorResponse('Ruta no encontrada. Usa /chat o /transcribe', 404, origin);
  },
};