import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* ─── Types ──────────────────────────────────────────────── */

interface EmailSummary {
  subject: string;
  date: string;
  snippet: string;
}

/* ─── Gmail REST helpers ─────────────────────────────────── */

async function gmailSearch(token: string, query: string, maxResults = 50): Promise<string[]> {
  const url =
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?' +
    new URLSearchParams({ q: query, maxResults: String(maxResults) });

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error('Token de Google expirado. Vuelve a conectar Gmail.');
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return (data.messages ?? []).map((m: { id: string }) => m.id);
}

async function gmailGetMeta(token: string, id: string): Promise<EmailSummary | null> {
  const url =
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}` +
    `?format=metadata&metadataHeaders=Subject&metadataHeaders=Date`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const headers: Array<{ name: string; value: string }> = data.payload?.headers ?? [];
  return {
    subject: headers.find((h) => h.name === 'Subject')?.value ?? '',
    date: headers.find((h) => h.name === 'Date')?.value ?? '',
    snippet: data.snippet ?? '',
  };
}

/* ─── Anthropic helper ───────────────────────────────────── */

async function callClaude(messages: Array<{ role: string; content: string }>): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5',
      max_tokens: 8192,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const blocks: Array<{ type: string; text?: string }> = data.content ?? [];
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

/* ─── JSON extraction ────────────────────────────────────── */

function extractArray(text: string): unknown[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
}

/* ─── Route ──────────────────────────────────────────────── */

export async function POST(req: NextRequest) {
  const { existingNames = [], googleToken } = await req.json();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(evt: object) {
        controller.enqueue(encoder.encode(JSON.stringify(evt) + '\n'));
      }

      try {
        /* ── Guards ── */
        if (!googleToken) {
          send({ type: 'log', msg: 'Token de Google no recibido. Conecta Gmail primero.', level: 'err' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }
        if (!process.env.ANTHROPIC_API_KEY) {
          send({ type: 'log', msg: 'ANTHROPIC_API_KEY no configurada en Vercel.', level: 'err' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        /* ── Step 1: Search Gmail ── */
        send({ type: 'log', msg: 'Conectando con Gmail…', level: 'info' });

        // Cast wide net — Bancolombia sends from various addresses
        const query = 'bancolombia (compra OR transaccion OR debito OR pago) newer_than:90d';
        let messageIds: string[];

        try {
          messageIds = await gmailSearch(googleToken, query, 50);
        } catch (err) {
          send({ type: 'log', msg: `${err instanceof Error ? err.message : String(err)}`, level: 'err' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        send({
          type: 'log',
          msg: `Encontrados ${messageIds.length} correos candidatos`,
          level: messageIds.length > 0 ? 'ok' : 'info',
        });

        if (messageIds.length === 0) {
          send({ type: 'log', msg: 'No hay correos de Bancolombia en los últimos 90 días.', level: 'info' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        /* ── Step 2: Fetch metadata in parallel (up to 40) ── */
        send({ type: 'log', msg: 'Leyendo contenido de correos…', level: 'info' });

        const toFetch = messageIds.slice(0, 40);
        const metas = await Promise.all(toFetch.map((id) => gmailGetMeta(googleToken, id)));
        const emails: EmailSummary[] = metas.filter((m): m is EmailSummary => m !== null);

        send({ type: 'log', msg: `Procesando ${emails.length} correos…`, level: 'info' });

        /* ── Step 3: Claude extracts transactions ── */
        send({ type: 'log', msg: 'Extrayendo transacciones con IA…', level: 'info' });

        const emailBlock = emails
          .map((e, i) => `[${i + 1}] Asunto: ${e.subject}\nFecha: ${e.date}\nContenido: ${e.snippet}`)
          .join('\n\n');

        const extractPrompt = `Eres un asistente que extrae datos de transacciones bancarias de correos de Bancolombia Colombia.

Analiza estos correos y extrae cada transacción de compra o débito:

${emailBlock}

Para cada transacción extrae:
- merchant: nombre del comercio o servicio (string limpio, sin asteriscos ni ruido)
- amount: monto en COP como número entero (sin puntos, comas ni $)
- date: fecha en formato YYYY-MM-DD

Reglas:
- Ignora correos que no sean notificaciones de transacciones (ej: publicidad, estados de cuenta)
- Si el monto aparece como "15.000" en español, el número es 15000
- Si hay múltiples transacciones en un correo, extrae cada una por separado

Devuelve ÚNICAMENTE un array JSON sin texto adicional:
[{"merchant":"Netflix","amount":17900,"date":"2025-03-15"},...]

Si no hay transacciones claras devuelve: []`;

        let transactions: Array<{ merchant: string; amount: number; date: string }> = [];

        try {
          const r1 = await callClaude([{ role: 'user', content: extractPrompt }]);
          transactions = extractArray(r1) as typeof transactions;
          send({
            type: 'log',
            msg: `Extraídas ${transactions.length} transacciones`,
            level: 'ok',
          });
        } catch (err) {
          send({
            type: 'log',
            msg: `Error al extraer transacciones: ${err instanceof Error ? err.message : String(err)}`,
            level: 'err',
          });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        if (transactions.length === 0) {
          send({ type: 'log', msg: 'No se encontraron transacciones en los correos.', level: 'info' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        /* ── Step 4: Claude detects recurring subscriptions ── */
        send({
          type: 'log',
          msg: `Analizando recurrencia en ${transactions.length} transacciones…`,
          level: 'info',
        });

        const exclusion =
          (existingNames as string[]).length > 0
            ? `\nExcluye estas que ya están registradas: ${(existingNames as string[]).join(', ')}`
            : '';

        const analyzePrompt = `Analiza estas transacciones de Bancolombia Colombia e identifica suscripciones recurrentes:

${JSON.stringify(transactions, null, 2)}

Considera suscripción si:
1. El mismo comercio aparece 2 o más veces con montos similares
2. Es un servicio de suscripción conocido (Netflix, Spotify, YouTube Premium, Amazon Prime, Disney+, Apple Music, Apple TV+, Max, Paramount+, Crunchyroll, Adobe Creative Cloud, Microsoft 365, Dropbox, iCloud+, Google One, ChatGPT Plus, Midjourney, GitHub Copilot, Duolingo, Canva, etc.)
3. Muestra intervalo regular (~30 días para mensual, ~365 días para anual)
${exclusion}

Para cada suscripción detectada devuelve:
- name: nombre limpio y capitalizado (ej: "Netflix", "Spotify", "Adobe Creative Cloud")
- amount: monto más reciente en COP (número entero)
- cycle: "mensual" o "anual" según el patrón observado
- lastCharge: fecha del cargo más reciente YYYY-MM-DD

Devuelve ÚNICAMENTE un array JSON sin texto adicional:
[{"name":"Netflix","amount":17900,"cycle":"mensual","lastCharge":"2025-03-15"},...]

Si no hay suscripciones devuelve: []`;

        let detected: Array<{
          name: string;
          amount: number;
          cycle: 'mensual' | 'anual';
          lastCharge?: string;
        }> = [];

        try {
          const r2 = await callClaude([{ role: 'user', content: analyzePrompt }]);
          detected = extractArray(r2) as typeof detected;
        } catch (err) {
          send({
            type: 'log',
            msg: `Error al analizar suscripciones: ${err instanceof Error ? err.message : String(err)}`,
            level: 'err',
          });
        }

        /* ── Filter already-known ── */
        const existing = new Set((existingNames as string[]).map((n: string) => n.toLowerCase()));
        const fresh = detected.filter((d) => !existing.has(d.name.toLowerCase()));

        send({
          type: 'log',
          msg:
            fresh.length > 0
              ? `✓ Detectadas ${fresh.length} nuevas suscripciones`
              : 'No se detectaron nuevas suscripciones recurrentes.',
          level: fresh.length > 0 ? 'ok' : 'info',
        });

        send({ type: 'done', items: fresh });
      } catch (err) {
        send({
          type: 'log',
          msg: `Error inesperado: ${err instanceof Error ? err.message : String(err)}`,
          level: 'err',
        });
        send({ type: 'done', items: [] });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
