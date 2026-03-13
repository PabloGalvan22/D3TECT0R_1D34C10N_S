# SentinelCareAI — Contigo Siempre

> Plataforma PWA de apoyo emocional y detección de riesgo con inteligencia artificial.  
> Diseñada para el contexto hispanohablante mexicano.

![Versión](https://img.shields.io/badge/versión-2.0-teal)
![Licencia](https://img.shields.io/badge/licencia-MIT-green)
![PWA](https://img.shields.io/badge/PWA-ready-blue)
![Modelo](https://img.shields.io/badge/modelo-Llama%203.3%2070B-orange)

---

## Índice

- [¿Qué es?](#qué-es)
- [Características](#características)
- [Arquitectura](#arquitectura)
- [Estructura de archivos](#estructura-de-archivos)
- [Instalación y despliegue](#instalación-y-despliegue)
- [Configuración del Worker](#configuración-del-worker)
- [Perfiles de usuario](#perfiles-de-usuario)
- [Módulo profesional](#módulo-profesional)
- [Seguridad](#seguridad)
- [PWA y modo offline](#pwa-y-modo-offline)
- [Mejoras aplicadas](#mejoras-aplicadas)
- [Créditos y tecnologías](#créditos-y-tecnologías)

---

## ¿Qué es?

SentinelCareAI es una aplicación web progresiva (PWA) que combina:

- **Aura** — un asistente de apoyo emocional empático, basado en Llama 3.3 70B vía Groq
- **Detector de riesgo** — análisis por palabras clave con validación de segunda capa mediante IA
- **Módulo profesional** — herramienta para psicólogos y docentes con análisis masivo de texto, reportes clínicos y exportación a Excel

Funciona completamente en el navegador como PWA instalable, con soporte offline para el chat.

---

## Características

### Chat con Aura
- Conversación empática con memoria de sesión completa
- Detección automática de crisis con overlay de recursos de emergencia
- Soporte de archivos adjuntos (texto e imágenes)
- Reconocimiento de voz vía Groq Whisper
- Modo offline: respuestas locales predefinidas por categoría cuando no hay red
- Persistencia opcional del historial (consentimiento explícito del usuario)
- Sesión guardada con expiración automática a los 7 días

### Rastreador de bienestar
- Selector de estado emocional diario (5 niveles)
- Historial visual con Chart.js
- Datos persistidos en localStorage

### Módulo profesional (acceso con contraseña)
- Carga de archivos Excel/CSV con columnas de texto libre
- Detección de riesgo por palabras clave en 7 categorías: suicidio, autolesión, violencia, abuso, crisis, sustancias, aislamiento
- Validación IA en lotes de 15 casos (ALTO/EXTREMO) para reducir falsos positivos
- Análisis clínico narrativo generado por IA con secciones estructuradas
- Nube de palabras clave (WordCloud2)
- OCR sobre imágenes con Tesseract.js
- Exportación a CSV y XLSX con hoja de resumen
- Notas clínicas por paciente con persistencia local
- Escala de valoración rápida del riesgo individual

---

## Arquitectura

```
┌─────────────────────────────────────┐
│           Navegador / PWA           │
│  index.html + JS + CSS              │
│  Service Worker (sentinelcare-v2)   │
└────────────────┬────────────────────┘
                 │ POST /chat  /transcribe
                 ▼
┌─────────────────────────────────────┐
│    Cloudflare Worker (Proxy)        │
│    sentinel-proxy.*.workers.dev     │
│                                     │
│  • Inyecta system prompt de Aura    │
│  • Valida modelos permitidos        │
│  • Clamp temperature / max_tokens   │
│  • Rate limit: 30 req/min · 500/día │
│  • CORS allowlist                   │
└────────────────┬────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────┐
│         Groq API                    │
│  Modelo: llama-3.3-70b-versatile    │
└─────────────────────────────────────┘
```

---

## Estructura de archivos

```
proyecto/
├── index.html          # App completa (PWA single-page)
├── manifest.json       # Manifiesto PWA
├── sw.js               # Service Worker v2
├── offline.html        # Página de fallback sin conexión
├── favicon.ico         # Favicon multi-tamaño (64/32/16px)
├── icon-192.png        # Ícono PWA 192×192
├── icon-512.png        # Ícono PWA 512×512
├── worker.js           # Cloudflare Worker (proxy seguro)
└── wrangler.toml       # Configuración de Cloudflare Workers
```

---

## Instalación y despliegue

### Requisitos
- Cuenta en [Cloudflare](https://cloudflare.com) (gratuita)
- Cuenta en [Groq](https://console.groq.com) con API key
- Repositorio en GitHub Pages (u otro hosting estático)

### 1. Clonar y configurar

```bash
git clone https://github.com/tu-usuario/SentinelCareAI.git
cd SentinelCareAI
```

### 2. Desplegar el Worker en Cloudflare

```bash
# Instalar Wrangler CLI
npm install -g wrangler

# Autenticarse
wrangler login

# Agregar la API key de Groq como secret (nunca en el código)
wrangler secret put GROQ_API_KEY

# Desplegar
wrangler deploy
```

> Anota la URL que devuelve Wrangler (ej: `https://sentinel-proxy.tu-usuario.workers.dev`)  
> y actualízala en `index.html` en la variable `PROXY_BASE_URL`.

### 3. Subir los archivos estáticos

Sube todos los archivos (excepto `worker.js` y `wrangler.toml`) a GitHub Pages o tu hosting preferido.

```bash
git add .
git commit -m "deploy: SentinelCareAI v2"
git push origin main
```

### 4. Primera vez en producción

Abre la app en **modo incógnito** para que el Service Worker se registre limpiamente sin conflictos de caché.

---

## Configuración del Worker

### `wrangler.toml`

```toml
name = "sentinel-proxy"
main = "worker.js"
compatibility_date = "2025-01-01"

[observability]
enabled = true   # Logs en Cloudflare Dashboard → Workers → sentinel-proxy
```

### Variables de entorno

| Variable | Cómo configurar | Descripción |
|---|---|---|
| `GROQ_API_KEY` | `wrangler secret put GROQ_API_KEY` | API key de Groq (nunca en el código) |

### Rate limiting (en memoria)

| Límite | Valor |
|---|---|
| Máx. requests por minuto por IP | 30 |
| Máx. requests por día por IP | 500 |

> El rate limiter vive en memoria del Worker. Se reinicia en cold starts. Para persistencia total se necesitaría Cloudflare KV.

### Modelos permitidos (allowlist)

- `llama-3.3-70b-versatile` *(default)*
- `llama-3.1-8b-instant`
- `llama-3.2-11b-vision-preview`
- `llama-3.2-90b-vision-preview`
- `mixtral-8x7b-32768`
- `gemma2-9b-it`

---

## Perfiles de usuario

| Perfil | Descripción |
|---|---|
| **Joven** | Adolescentes y jóvenes adultos |
| **Adulto** | Adultos en general |
| **Salud** | Profesionales de la salud |
| **Maestro/a** | Docentes con alumnos en riesgo |
| **Padre/Madre** | Padres y tutores preocupados |

Cada perfil carga un saludo inicial personalizado y adapta el contexto del chat.

---

## Módulo profesional

Acceso protegido con contraseña hasheada en el cliente.

### Flujo de análisis

```
1. Cargar Excel/CSV
        ↓
2. Seleccionar columna de texto
        ↓
3. Análisis por palabras clave (local, sin red)
        ↓
4. Clasificación: NULO / BAJO / MEDIO / ALTO / EXTREMO
        ↓
5. Validación IA automática (casos ALTO/EXTREMO)
   → Lotes de 15 casos · pausa 1.2s entre lotes
   → Veredicto: REAL o FALSO_POSITIVO
        ↓
6. Análisis clínico narrativo (botón manual)
        ↓
7. Exportar CSV / XLSX
```

### Categorías de detección

- Suicidio e ideación suicida
- Autolesión
- Violencia (hacia otros)
- Abuso y violación
- Crisis emocional severa
- Sustancias
- Aislamiento social extremo

---

## Seguridad

| Medida | Descripción |
|---|---|
| API key server-side | La key de Groq nunca llega al navegador |
| System prompt server-side | El Worker inyecta el prompt de Aura; el cliente envía el suyo como fallback |
| Filtro de rol `system` | El Worker elimina cualquier `role: system` enviado por el cliente |
| Allowlist de modelos | Solo se aceptan modelos Groq predefinidos |
| Clamp de parámetros | `temperature` ≤ 1.5, `max_tokens` ≤ 2000 |
| Rate limiting por IP | 30 req/min · 500 req/día |
| CORS estricto | Solo orígenes autorizados reciben headers CORS |
| DOMPurify | Todo HTML generado por IA se sanitiza antes de inyectarse al DOM |
| Contraseña profesional | Hash SHA-256 verificado en cliente (sin transmisión) |
| Historial opt-in | El chat no se guarda sin consentimiento explícito del usuario |

---

## PWA y modo offline

### Service Worker (`sentinelcare-v2`)

| Tipo de recurso | Estrategia |
|---|---|
| Proxy Groq | Network only (nunca cachear) |
| CDN externos (fonts, Chart.js…) | Cache-first + actualización background |
| Navegación (HTML) | Network-first + fallback a `offline.html` |
| Assets propios | Network-first + fallback a caché |

### `offline.html`
Página de marca que se muestra cuando no hay red ni caché disponible. Incluye:
- Indicador de estado en tiempo real
- Línea de crisis CONASAMA visible siempre
- Auto-redirect al volver la conexión (1.8s de espera)
- Recordatorio de que el chat offline de Aura sigue disponible en la app

### Instalación como app
La app es instalable en Android, iOS y escritorio gracias al `manifest.json`. Incluye:
- Íconos 192×192 y 512×512
- Orientación portrait-primary
- Tema `#3d7a8a`
- Shortcuts: *Chat de apoyo* y *Líneas de crisis*

---

## Mejoras aplicadas

A continuación el registro completo de las mejoras implementadas durante el desarrollo:

### 🔴 Críticas (seguridad / corrección)

| # | Fix | Archivo |
|---|---|---|
| 1 | **Bug `\\n` en prompt** — `join('\\\\n')` producía texto literal en lugar de saltos de línea; el modelo recibía los casos pegados | `index.html` |
| 2 | **Allowlist de modelos en Worker** — sin validación, un atacante podía usar la API key con cualquier modelo y parámetros arbitrarios | `worker.js` |
| 3 | **`compatibility_date` desactualizada** — `"2024-01-01"` → `"2025-01-01"` para APIs de Cloudflare actuales | `wrangler.toml` |
| 4 | **Validación IA truncada** — `slice(0, 15)` silencioso dejaba casos sin validar; reemplazado por lotes paginados con progreso visible | `index.html` |

### 🟠 Importantes (rendimiento / fiabilidad)

| # | Fix | Archivo |
|---|---|---|
| 6 | **Carga diferida de scripts pesados** — Tesseract.js (~2 MB), xlsx (~1.7 MB) y WordCloud2 solo cargan al entrar al módulo profesional | `index.html` |
| 8 | **Página offline + fallback SW** — `offline.html` precacheada; el SW devuelve la página de marca en lugar de error del navegador | `sw.js`, `offline.html` |
| 9 | **System prompt server-side** — el Worker inyecta el prompt de Aura eliminando cualquier `role:system` del cliente; el frontend mantiene copia como fallback | `worker.js`, `index.html` |

### 🟡 Menores (calidad / UX)

| # | Fix | Archivo |
|---|---|---|
| 10 | **DOMPurify en `marked.parse()`** — todo HTML generado por IA sanitizado antes de inyectarse al DOM | `index.html` |
| 11 | **Íconos PWA** — `icon-192.png` e `icon-512.png` generados desde el logo oficial | `icon-*.png` |
| 12 | **Observability en Cloudflare** — `[observability] enabled = true` activa logs en el dashboard sin costo | `wrangler.toml` |
| 13 | **Form de contraseña accesible** — `<input type="password">` envuelto en `<form>` con campo `username` oculto; el botón del ojo usa `type="button"` | `index.html` |
| 14 | **`favicon.ico`** — generado en 3 tamaños (64/32/16px) con `<link rel="icon">` en el `<head>` | `favicon.ico`, `index.html` |
| 15 | **`compatibility_date` bump** — versión de APIs de Cloudflare actualizada | `wrangler.toml` |

---

## Créditos y tecnologías

| Tecnología | Uso |
|---|---|
| [Groq](https://groq.com) | Inferencia LLM (Llama 3.3 70B) y transcripción Whisper |
| [Cloudflare Workers](https://workers.cloudflare.com) | Proxy seguro, rate limiting, inyección de system prompt |
| [Chart.js](https://chartjs.org) | Gráficas del rastreador de bienestar y análisis de riesgo |
| [marked.js](https://marked.js.org) | Renderizado de Markdown en respuestas de Aura |
| [DOMPurify](https://github.com/cure53/DOMPurify) | Sanitización de HTML generado por IA |
| [Tesseract.js](https://tesseract.projectnaptha.com) | OCR sobre imágenes en el módulo profesional |
| [SheetJS (xlsx)](https://sheetjs.com) | Lectura y exportación de archivos Excel |
| [WordCloud2.js](https://github.com/timdream/wordcloud2.js) | Nube de palabras clave de riesgo |
| [Font Awesome 6](https://fontawesome.com) | Íconografía |
| [Google Fonts](https://fonts.google.com) | Playfair Display + DM Sans |

---

## Líneas de crisis incluidas

| Línea | Número | Disponibilidad |
|---|---|---|
| CONASAMA | 800 290-0024 | 24 hrs, gratuito |
| DIF Nacional | 800 222-2268 | 24 hrs, gratuito |
| SSG Guanajuato | 800 002-2700 | Horario extendido |
| Emergencias | 911 | 24 hrs |

---

## Licencia

MIT © 2026 — Pablo Galván / SentinelCareAI

> **Aviso clínico:** SentinelCareAI es una herramienta de apoyo y orientación. No constituye diagnóstico clínico ni reemplaza la atención profesional de salud mental. En situaciones de crisis, siempre contactar una línea de emergencias o un profesional calificado.
