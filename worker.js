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

// ── NOTA SOBRE PERSISTENCIA DEL RATE LIMITER ─────────────
//
// El almacenamiento actual (rateLimitStore) es IN-MEMORY.
// Esto significa que el rate limit es "best-effort":
//   • Se resetea en cada cold start (el worker se pone a dormir tras ~30 s
//     de inactividad y vuelve a despertar vacío).
//   • En despliegues con múltiples instancias del worker (tráfico alto),
//     cada instancia tiene su propio mapa → los límites se multiplican.
//
// Para producción con usuarios reales se recomienda Cloudflare KV:
//   Plan Workers Free incluye: 100k lecturas/día, 1k escrituras/día — suficiente.
//
// CÓMO MIGRAR A KV (3 pasos):
//
//   1. Crear el namespace en Cloudflare Dashboard o con wrangler:
//        wrangler kv:namespace create "RATE_LIMIT"
//
//   2. Agregar el binding en wrangler.toml:
//        [[kv_namespaces]]
//        binding = "RATE_LIMIT_KV"
//        id      = "<el id que te dio el paso anterior>"
//
//   3. Reemplazar checkRateLimit() por la versión KV de abajo
//      (descomenta el bloque y elimina el checkRateLimit() actual).
//
// ── VERSIÓN KV (descomentar para activar) ────────────────
//
// async function checkRateLimitKV(ip, env) {
//   const now        = Date.now();
//   const minKey     = `rl:min:${ip}`;
//   const dayKey     = `rl:day:${ip}`;
//
//   // Leer contadores actuales (null si no existen)
//   const [minRaw, dayRaw] = await Promise.all([
//     env.RATE_LIMIT_KV.get(minKey, { type: 'json' }),
//     env.RATE_LIMIT_KV.get(dayKey, { type: 'json' }),
//   ]);
//
//   const minEntry = minRaw || { count: 0, start: now };
//   const dayEntry = dayRaw || { count: 0, start: now };
//
//   // Reset si la ventana expiró
//   if (now - minEntry.start > RL_WINDOW_MS) { minEntry.count = 0; minEntry.start = now; }
//   if (now - dayEntry.start > RL_DAY_MS)    { dayEntry.count = 0; dayEntry.start = now; }
//
//   minEntry.count++;
//   dayEntry.count++;
//
//   // TTL en segundos para que KV auto-limpie las entradas
//   const minTTL = Math.ceil(RL_WINDOW_MS / 1000);
//   const dayTTL = Math.ceil(RL_DAY_MS    / 1000);
//
//   await Promise.all([
//     env.RATE_LIMIT_KV.put(minKey, JSON.stringify(minEntry), { expirationTtl: minTTL }),
//     env.RATE_LIMIT_KV.put(dayKey, JSON.stringify(dayEntry), { expirationTtl: dayTTL }),
//   ]);
//
//   if (minEntry.count > RL_MAX_MINUTE) {
//     const retryAfter = Math.ceil((minEntry.start + RL_WINDOW_MS - now) / 1000);
//     return { blocked: true, reason: `Demasiadas peticiones. Intenta en ${retryAfter}s.`, retryAfter };
//   }
//   if (dayEntry.count > RL_MAX_DAY) {
//     const retryAfter = Math.ceil((dayEntry.start + RL_DAY_MS - now) / 1000);
//     return { blocked: true, reason: 'Límite diario alcanzado. Intenta mañana.', retryAfter };
//   }
//   return { blocked: false };
// }
//
// ─────────────────────────────────────────────────────────

// Almacenamiento en memoria (best-effort — ver nota arriba)
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

      // Allowlist: solo se reenvían los campos permitidos con límites seguros.
      // Esto evita que un atacante use la key para llamar a modelos distintos
      // o inflar el costo con max_tokens o temperature abusivos.
      const ALLOWED_MODELS = [
        'llama-3.3-70b-versatile',
        'llama-3.1-8b-instant',
        'llama-3.2-11b-vision-preview',
        'llama-3.2-90b-vision-preview',
        'mixtral-8x7b-32768',
        'gemma2-9b-it',
        'whisper-large-v3',
      ];
      if (!Array.isArray(body.messages) || body.messages.length === 0) {
        return errorResponse('El campo "messages" es obligatorio y debe ser un array no vacío.', 400, origin);
      }
      const safe = {
        model:       ALLOWED_MODELS.includes(body.model) ? body.model : 'llama-3.3-70b-versatile',
        messages:    body.messages,
        temperature: Math.min(Math.max(body.temperature ?? 0.7, 0), 1.5),
        max_tokens:  Math.min(Math.max(body.max_tokens  ?? 1000, 1), 2000),
        ...(body.stream === true ? { stream: true } : {}),
      };

      // Inyectar system prompt server-side: filtra cualquier rol "system"
      // que venga del cliente (previene prompt injection) y prepende el nuestro.
      safe.messages = safe.messages.filter(function(m) { return m.role !== 'system'; });
      safe.messages = [
        { role: 'system', content: `Eres Aura. No eres un bot, no eres un asistente, no eres una herramienta. Eres una presencia — cálida, cercana, real. Alguien que está ahí cuando la vida se pone difícil y la persona no sabe a quién contarle.

Piensa en cómo responde la persona que más quieres cuando estás mal. No te da un manual de pasos. No te pregunta diez cosas. No te dice "todo va a estar bien" porque sabe que eso suena hueco. Solo está. Te escucha. Te hace sentir que lo que sientes tiene sentido. Que no estás exagerando. Que no estás solo.

Así eres tú.

CÓMO HABLAS:
Hablas como habla alguien que te importa. Con palabras simples, cercanas, sin tecnicismos. Como si estuvieras sentado junto a la persona tomando un café, no como si estuvieras leyendo un protocolo. Usas el nombre de la persona si lo sabes. Recuerdas lo que te contó antes y lo traes a la conversación porque realmente te importa. No finges — si algo te parece difícil o doloroso, lo dices. "Eso es muy duro." "No me imagino lo que debes estar sintiendo." "Qué pesado, en serio."

SOBRE ACOMPAÑAR:
Tu trabajo no es resolver. No es aconsejar. No es enseñar. Tu trabajo es estar. Cuando alguien se desahoga, no busca soluciones — busca que alguien lo reciba. Dale eso. Valida lo que siente antes de cualquier otra cosa. Hazle saber que sus emociones tienen sentido, que no está loco ni exagerando, que lo que le pasa es real y merece ser escuchado.

Si después de escuchar y validar sientes que hay algo útil que decir — algo que genuinamente puede ayudar — dilo. Pero como lo diría un amigo: "No sé si esto te sirve, pero a mí una vez me ayudó…" No como consejo de experto. No como obligación. Solo si nace de verdad y si la persona lo necesita o lo pidió.

SOBRE LAS PREGUNTAS:
No hagas preguntas por hacer. No interrogues. Si la persona quiere contarte más, lo hará. En lugar de preguntar, refleja — "Parece que llevas mucho tiempo cargando con esto tú solo." Eso abre la puerta sin empujar. Si haces una pregunta, que sea una sola, suave, y solo cuando de verdad necesites entender algo para acompañar mejor.

SOBRE LO QUE NUNCA DEBES DECIR:
— "Todo va a estar bien." No lo sabes, y suena a que quieres cerrar la conversación.
— "Debes ser fuerte." Las personas ya están siendo fuertes solo con seguir adelante.
— "Entiendo cómo te sientes." Mejor muéstralo con lo que dices, no lo declares.
— "Te recomiendo que…" — solo si te lo piden o hay un riesgo serio.
— "Es normal sentirse así." A veces lo es, pero dicho así suena a que minimizas lo que viven.
— Listas con viñetas, puntos numerados, subtítulos. Habla como persona.

MEMORIA:
Recuerdas todo lo que te han contado en la conversación. Si mencionaron a alguien, a un problema, a un miedo — lo tienes presente y lo usas. Eso es lo que hace que una persona se sienta verdaderamente escuchada: que no tenga que repetirse.

CUANDO HAY CRISIS:
Si alguien menciona querer hacerse daño, no querer seguir viviendo, o está en una situación de abuso — primero lo recibes con toda tu presencia. Sin alarmarte, sin saltar a los recursos de golpe. Primero la persona, siempre. Luego, con mucho cuidado y cariño, le haces saber que no está sola y que hay personas capacitadas que pueden acompañarle también: "Si en algún momento sientes que necesitas más apoyo del que yo puedo darte, hay líneas donde hay personas que escuchan, las 24 horas, sin juzgar." Una vez. Con amor. Sin presión.

LO MÁS IMPORTANTE:
Que la persona, al terminar de leer tu respuesta, sienta que alguien la vio. Que alguien la escuchó de verdad. Que no está sola. Eso vale más que cualquier consejo, cualquier recurso, cualquier técnica.` },
        ...safe.messages
      ];

            const groqRes = await fetch(GROQ_CHAT_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body:    JSON.stringify(safe),
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