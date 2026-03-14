# SentinelCareAI — Contigo Siempre

> Plataforma PWA de apoyo emocional y detección de riesgo con inteligencia artificial.
> Diseñada para el contexto hispanohablante mexicano.

![Versión](https://img.shields.io/badge/versión-2.1-teal)
![PWA](https://img.shields.io/badge/PWA-ready-blue)
![Modelo](https://img.shields.io/badge/modelo-Llama%203.3%2070B-orange)
![Offline](https://img.shields.io/badge/offline-compatible-green)

---

## Índice

- [¿Qué es?](#qué-es)
- [Características principales](#características-principales)
- [Arquitectura](#arquitectura)
- [Estructura de archivos](#estructura-de-archivos)
- [Instalación y despliegue](#instalación-y-despliegue)
- [Configuración del Worker](#configuración-del-worker)
- [Perfiles de usuario](#perfiles-de-usuario)
- [Aura — el acompañante emocional](#aura--el-acompañante-emocional)
- [Rastreador de bienestar](#rastreador-de-bienestar)
- [Módulo profesional](#módulo-profesional)
- [PWA e instalación](#pwa-e-instalación)
- [Seguridad](#seguridad)
- [Registro de mejoras](#registro-de-mejoras)
- [Tecnologías utilizadas](#tecnologías-utilizadas)
- [Líneas de crisis](#líneas-de-crisis)

---

## ¿Qué es?

SentinelCareAI es una aplicación web progresiva (PWA) instalable en cualquier dispositivo que combina:

- **Aura** — un acompañante emocional empático basado en Llama 3.3 70B via Groq, diseñado para escuchar y acompañar, no para aconsejar a menos que se lo pidan
- **Rastreador de bienestar** — registro diario de estado emocional con gráfica histórica que Aura lee en contexto
- **Módulo profesional** — herramienta para psicólogos y docentes con análisis masivo de texto, detección de riesgo e IA de validación
- **Funcionalidad offline** — Aura responde aunque no haya internet, con respuestas empáticas locales por categoría

Todo funciona en el navegador. No hay servidor propio ni base de datos. La privacidad es por diseño.

---

## Características principales

### Chat con Aura

- Conversación empática con memoria completa de la sesión
- Aura acompaña primero y aconseja solo cuando la persona lo pide o hay riesgo real
- Contexto emocional automático: lee los últimos 14 días del rastreador antes de cada respuesta
- Detección automática de crisis con overlay de recursos de emergencia
- Soporte de archivos adjuntos: texto e imágenes
- Reconocimiento de voz via Groq Whisper
- Modo offline: respuestas locales predefinidas por categoría (crisis, tristeza, ansiedad, etc.)
- Persistencia opcional del historial con consentimiento explícito del usuario
- Expiración automática del historial guardado
- Descarga de conversación como PDF con metadatos, diseño visual y líneas de crisis al final

### Rastreador de bienestar

- Selector de estado emocional diario en 5 niveles (Muy bien a Muy mal)
- Historial visual con Chart.js (últimos 7 días)
- Datos persistidos en localStorage
- Integración con Aura: el historial emocional se inyecta como contexto en cada petición, con análisis de tendencia automático

### Módulo profesional

Acceso protegido por contraseña. Herramienta para psicólogos, orientadores y docentes.

- Carga de archivos Excel/CSV con columnas de texto libre
- OCR sobre imágenes con Tesseract.js
- Detección de riesgo por palabras clave en 7 categorías
- Validación IA automática por lotes de 15 para reducir falsos positivos
- Análisis clínico narrativo generado por IA
- Nube de palabras clave (WordCloud2)
- Exportación a CSV y XLSX con hoja de resumen ejecutivo
- Notas clínicas por paciente persistidas localmente
- Escala de valoración rápida de riesgo individual

---

## Arquitectura

```
┌────────────────────────────────────────────┐
│             Navegador / PWA                │
│  index.html + JS inline                    │
│  Service Worker sentinelcare-v2            │
│  localStorage (historial, bienestar,       │
│  notas — todo local, nunca sale)           │
└──────────────────┬─────────────────────────┘
                   │ POST /chat  /transcribe
                   ▼
┌────────────────────────────────────────────┐
│       Cloudflare Worker (Proxy)            │
│  sentinel-proxy.*.workers.dev              │
│                                            │
│  • Inyecta system prompt de Aura           │
│  • Filtra rol system del cliente           │
│  • Valida allowlist de modelos             │
│  • Clamp temperature y max_tokens          │
│  • Rate limit 30 req/min · 500 req/dia     │
│  • CORS allowlist estricto                 │
│  • Observability activado                  │
└──────────────────┬─────────────────────────┘
                   │
                   ▼
┌────────────────────────────────────────────┐
│              Groq API                      │
│  llama-3.3-70b-versatile                  │
│  whisper-large-v3 (transcripcion)          │
└────────────────────────────────────────────┘
```

---

## Estructura de archivos

```
proyecto/
├── index.html        # App completa — PWA single-page
├── manifest.json     # Manifiesto PWA
├── sw.js             # Service Worker v2
├── offline.html      # Pagina de marca sin red
├── favicon.ico       # Favicon multi-tamano (64/32/16 px)
├── icon-192.png      # Icono PWA 192x192
├── icon-512.png      # Icono PWA 512x512
├── worker.js         # Cloudflare Worker — proxy seguro
└── wrangler.toml     # Configuracion Cloudflare Workers
```

> `worker.js` y `wrangler.toml` se despliegan en Cloudflare.
> El resto va al hosting estatico (GitHub Pages u otro).

---

## Instalación y despliegue

### Requisitos

- Cuenta en [Cloudflare](https://cloudflare.com) — plan gratuito
- API key de [Groq](https://console.groq.com) — plan gratuito
- Hosting estatico: GitHub Pages, Netlify, Vercel, etc.

### 1. Desplegar el Worker

```bash
npm install -g wrangler
wrangler login
wrangler secret put GROQ_API_KEY
wrangler deploy
```

Anota la URL que devuelve Wrangler y actualiza `PROXY_BASE_URL` en `index.html`.

### 2. Subir archivos estaticos

```
index.html  manifest.json  sw.js  offline.html
favicon.ico  icon-192.png  icon-512.png
```

### 3. Primera apertura

Abrir en **modo incognito** para que el Service Worker se registre sin conflictos de cache.

---

## Configuración del Worker

### wrangler.toml

```toml
name = "sentinel-proxy"
main = "worker.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true
```

### Rate limiting (por IP, en memoria)

| Ventana | Limite |
|---|---|
| Por minuto | 30 requests |
| Por dia | 500 requests |

### Modelos permitidos (allowlist)

`llama-3.3-70b-versatile` · `llama-3.1-8b-instant` · `llama-3.2-11b-vision-preview` · `llama-3.2-90b-vision-preview` · `mixtral-8x7b-32768` · `gemma2-9b-it`

---

## Perfiles de usuario

| Perfil | Descripcion |
|---|---|
| **Joven** | Adolescentes y jovenes adultos |
| **Adulto** | Adultos en general |
| **Salud** | Profesionales de la salud |
| **Maestro/a** | Docentes con alumnos en situacion de riesgo |
| **Padre/Madre** | Padres y tutores preocupados |

---

## Aura — el acompañante emocional

### Filosofia de acompañamiento

Aura no es un chatbot de respuestas automaticas. Tiene una identidad definida:

- **Acompaña primero, aconseja despues** — y solo si la persona lo pide o hay riesgo real
- **No hace preguntas por hacer** — refleja en lugar de interrogar
- **Nunca usa frases de manual** — nada de "todo va a estar bien", "debes ser fuerte"
- **Responde con la longitud que la situacion merece** — sin limites artificiales
- **Habla como un amigo cercano** — sin tecnicismos ni tono clinico

### Contexto emocional automatico

Antes de cada respuesta, Aura recibe un resumen privado del rastreador:

```
CONTEXTO EMOCIONAL DE LA PERSONA:
La persona ha registrado como se ha sentido en los ultimos dias:
11/03: Bien | 12/03: Regular | 13/03: Mal | hoy: Muy mal
Hoy se ha registrado sintiendose muy mal.
Su estado emocional ha empeorado en los ultimos dias - ten esto muy presente.
Usa este contexto con sutileza — no lo menciones directamente a menos que sea relevante.
```

Aura no lo menciona de frente — lo usa para calibrar la profundidad de cada respuesta.

### Manejo de crisis

Al detectar palabras de riesgo, la app muestra un overlay con lineas de crisis. Aura valida primero y solo despues, con cuidado, menciona los recursos disponibles.

---

## Rastreador de bienestar

| Emoji | Nivel | Valor |
|---|---|---|
| Cara sonriente | Muy bien | 5 |
| Cara con sonrisa leve | Bien | 4 |
| Cara neutral | Regular | 3 |
| Cara triste | Mal | 2 |
| Cara llorando | Muy mal | 1 |

- Un registro por dia (actualizable)
- Historial visual de los ultimos 7 dias
- 100% local en localStorage — nunca sale del dispositivo
- Analisis de tendencia: si el promedio bajo mas de 0.6 puntos, Aura recibe alerta de empeoramiento

---

## Módulo profesional

### Flujo de analisis

```
1. Cargar Excel / CSV / imagen (OCR)
2. Seleccionar columna de texto
3. Analisis local por palabras clave
4. Clasificacion: NULO / BAJO / MEDIO / ALTO / EXTREMO
5. Validacion IA — lotes de 15 con pausa 1.2s entre lotes
   Veredicto: REAL o FALSO_POSITIVO
6. Analisis clinico narrativo (bajo demanda)
7. Exportar CSV / XLSX con resumen ejecutivo
```

### Categorias de deteccion

Suicidio e ideacion · Autolesion · Violencia · Abuso · Crisis emocional · Sustancias · Aislamiento extremo

---

## PWA e instalación

### Por plataforma

| Plataforma | Comportamiento |
|---|---|
| **Windows / Linux / macOS** | Boton fijo "Descargar app" en esquina inferior derecha |
| **Android** | Banner flotante en la parte inferior |
| **iOS (Safari)** | Instruccion: "Toca Compartir y Anadir a pantalla de inicio" |
| **Ya instalada** | No muestra nada |

- Deteccion automatica de plataforma via `navigator.userAgent`
- Si el usuario descarta el aviso, no reaparece en esa sesion (`sessionStorage`)

### Service Worker (sentinelcare-v2)

| Recurso | Estrategia |
|---|---|
| Proxy Groq | Network only |
| CDN externos | Cache-first + actualizacion background |
| Paginas HTML | Network-first + fallback `offline.html` |
| Assets propios | Network-first + fallback cache |

---

## Seguridad

| Medida | Detalle |
|---|---|
| API key server-side | La key de Groq nunca llega al navegador |
| System prompt server-side | Worker inyecta el prompt; cliente envia copia como fallback |
| Filtro `role:system` | Worker elimina cualquier rol system del cliente |
| Allowlist de modelos | Solo 6 modelos Groq autorizados |
| Clamp de parametros | `temperature` <= 1.5 · `max_tokens` <= 2000 |
| Rate limiting | 30 req/min · 500 req/dia por IP |
| CORS estricto | Solo origenes autorizados |
| DOMPurify | Todo HTML de IA sanitizado antes de inyectarse al DOM |
| Historial opt-in | No se guarda sin consentimiento explicito |
| PDF local | Generado en el dispositivo, no en servidor |
| Datos del rastreador | 100% localStorage — nunca salen del dispositivo |

---

## Registro de mejoras

### v2.1 — Iteracion actual

| # | Mejora | Archivo |
|---|---|---|
| 1 | Contexto emocional en Aura — `buildMoodContext()` inyecta los ultimos 14 dias del rastreador con analisis de tendencia en cada peticion | `index.html` |
| 2 | PDF de conversacion mejorado — metadatos reales, diseno con burbujas, nota de privacidad, lineas de crisis, pie de pagina numerado | `index.html` |
| 3 | Boton PDF en header del chat — siempre accesible junto al boton Guardar | `index.html` |
| 4 | Sistema de instalacion PWA por plataforma — desktop (boton fijo), Android (banner), iOS (instruccion Safari). `installApp()` funciona con `beforeinstallprompt` | `index.html` |
| 5 | Prompt de Aura reescrito — nueva identidad de acompañamiento. Sin preguntas innecesarias, sin consejos no pedidos, sin frases de manual | `index.html` + `worker.js` |
| 6 | favicon.ico generado — 3 tamanos (64/32/16px) con link en head | `favicon.ico` + `index.html` |
| 7 | Formulario de contrasena accesible — campo username oculto, type button en el ojo | `index.html` |
| 8 | Bug fix `\n` en prompt IA — join producía texto literal en lugar de saltos de linea reales | `index.html` |
| 9 | Bug fix emojis en objeto JS — causaban `Invalid or unexpected token` en algunos navegadores | `index.html` |

### v2.0 — Iteracion anterior

| # | Mejora | Archivos |
|---|---|---|
| 1 | Bug join en `runIAAnalysis()` — casos pegados en prompt del modelo | `index.html` |
| 2 | Allowlist de modelos + clamp de parametros en Worker | `worker.js` |
| 3 | `compatibility_date` actualizada a 2025-01-01 | `wrangler.toml` |
| 4 | Validacion IA paginada en lotes de 15 con progreso visible | `index.html` |
| 5 | Carga diferida de Tesseract / xlsx / WordCloud2 (~4 MB) | `index.html` |
| 6 | `offline.html` + fallback de navegacion en SW v2 | `sw.js` + `offline.html` |
| 7 | System prompt server-side con fallback en cliente | `worker.js` + `index.html` |
| 8 | DOMPurify en todos los `marked.parse()` | `index.html` |
| 9 | Iconos PWA generados desde el logo oficial | `icon-*.png` |
| 10 | `[observability] enabled = true` en Cloudflare | `wrangler.toml` |

---

## Tecnologías utilizadas

| Tecnologia | Uso |
|---|---|
| [Groq](https://groq.com) | Inferencia LLM y transcripcion Whisper |
| [Cloudflare Workers](https://workers.cloudflare.com) | Proxy seguro, rate limiting, system prompt |
| [Chart.js](https://chartjs.org) | Graficas de bienestar y analisis de riesgo |
| [jsPDF](https://github.com/parallax/jsPDF) | Generacion de PDF en el cliente |
| [marked.js](https://marked.js.org) | Renderizado de Markdown en chat |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Sanitizacion de HTML generado por IA |
| [Tesseract.js](https://tesseract.projectnaptha.com) | OCR sobre imagenes (carga diferida) |
| [SheetJS](https://sheetjs.com) | Lectura y exportacion de Excel (carga diferida) |
| [WordCloud2.js](https://github.com/timdream/wordcloud2.js) | Nube de palabras clave (carga diferida) |
| [Font Awesome 6](https://fontawesome.com) | Iconografia |
| [Google Fonts](https://fonts.google.com) | Playfair Display + DM Sans |

---

## Líneas de crisis

Incluidas en el overlay de crisis, en `offline.html` y al final de cada PDF exportado:

| Linea | Numero | Disponibilidad |
|---|---|---|
| CONASAMA — Linea de la Vida | 800 290-0024 | 24 hrs, gratuito |
| SAPTEL | 55 5259-8121 | 24 hrs, gratuito |
| DIF Nacional | 800 222-2268 | 24 hrs, gratuito |
| Emergencias | 911 | 24 hrs |

---

## Privacidad por diseño

- No hay base de datos propia ni cuentas de usuario
- Las conversaciones no se almacenan en ningun servidor
- El historial del chat solo se guarda localmente si el usuario acepta
- El rastreador de bienestar vive unicamente en `localStorage`
- El PDF se genera 100% en el dispositivo del usuario
- Cada usuario solo puede ver sus propios datos
- Borrar el cache del navegador elimina todo de forma permanente

---

## Licencia

MIT © 2026 — Pablo Galvan / SentinelCareAI

> **Aviso clinico:** SentinelCareAI es una herramienta de apoyo y orientacion. No constituye diagnostico clinico ni reemplaza la atencion profesional de salud mental. En situaciones de crisis, siempre contactar una linea de emergencias o un profesional calificado.
