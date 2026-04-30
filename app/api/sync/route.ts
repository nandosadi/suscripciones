import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

/* ─── Anthropic API helper ───────────────────────────────── */

interface McpServer {
  type: 'url';
  url: string;
  name: string;
  authorization_token?: string;
}

async function callClaude(params: {
  messages: Array<{ role: string; content: string }>;
  mcpServers?: McpServer[];
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: 'claude-opus-4-5',
    max_tokens: 8192,
    messages: params.messages,
  };

  if (params.mcpServers?.length) {
    body.mcp_servers = params.mcpServers;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04',
    },
    body: JSON.stringify(body),
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
        /* ── Guard ── */
        if (!googleToken) {
          send({ type: 'log', msg: 'Token de Google no recibido. Conecta Gmail primero.', level: 'err' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        if (!process.env.ANTHROPIC_API_KEY) {
          send({ type: 'log', msg: 'ANTHROPIC_API_KEY no configurada en el servidor.', level: 'err' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        /* ── Step 1: Extract transactions via Gmail MCP ── */
        send({ type: 'log', msg: 'Conectando con Gmail…', level: 'info' });
        send({ type: 'log', msg: 'Buscando correos de Bancolombia (últimos 90 días)…', level: 'info' });

        const gmailMcp: McpServer = {
          type: 'url',
          url: 'https://gmailmcp.googleapis.com/mcp/v1',
          name: 'gmail',
          authorization_token: googleToken,
        };

        const extractPrompt = `Usa las herramientas de Gmail disponibles para buscar correos de \
notificaciones de transacciones de Bancolombia de los últimos 90 días.

Busca correos con asuntos como "Compra realizada", "Transacción exitosa", \
"Notificación de pago", "Débito exitoso" o similares de Bancolombia.

Para cada transacción encontrada extrae:
- merchant: nombre del comercio o servicio (string)
- amount: monto en COP como número (sin puntos, sin comas, sin símbolo $)
- date: fecha en formato YYYY-MM-DD

Devuelve ÚNICAMENTE un array JSON, sin texto adicional ni bloques de código:
[{"merchant":"Netflix","amount":17900,"date":"2025-03-15"},...]

Si no hay correos devuelve: []`;

        let transactions: Array<{ merchant: string; amount: number; date: string }> = [];

        try {
          const r1 = await callClaude({
            messages: [{ role: 'user', content: extractPrompt }],
            mcpServers: [gmailMcp],
          });

          transactions = extractArray(r1) as typeof transactions;
          send({
            type: 'log',
            msg: `Encontradas ${transactions.length} transacciones en Gmail`,
            level: 'ok',
          });
        } catch (err) {
          send({
            type: 'log',
            msg: `Error al leer Gmail: ${err instanceof Error ? err.message : String(err)}`,
            level: 'err',
          });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        if (transactions.length === 0) {
          send({ type: 'log', msg: 'No se encontraron transacciones de Bancolombia.', level: 'info' });
          send({ type: 'done', items: [] });
          controller.close();
          return;
        }

        /* ── Step 2: Analyze for recurring subscriptions ── */
        send({
          type: 'log',
          msg: `Analizando ${transactions.length} transacciones para detectar suscripciones…`,
          level: 'info',
        });

        const exclusion =
          (existingNames as string[]).length > 0
            ? `\nExcluye estas suscripciones ya registradas: ${(existingNames as string[]).join(', ')}`
            : '';

        const analyzePrompt = `Analiza estas transacciones de Bancolombia y detecta suscripciones recurrentes:

${JSON.stringify(transactions, null, 2)}

Considera suscripción si:
1. El mismo comercio aparece 2 o más veces con montos similares
2. Es un servicio de suscripción conocido (Netflix, Spotify, YouTube Premium, \
Amazon Prime, Disney+, Apple Music, Apple TV+, HBO Max, Paramount+, Adobe, \
Microsoft 365, Dropbox, iCloud, ChatGPT, Midjourney, GitHub Copilot, etc.)
3. Muestra patrón temporal regular (mensual ~30 días, anual ~365 días)
${exclusion}

Para cada suscripción devuelve:
- name: nombre limpio capitalizado (ej: "Netflix", "Spotify")
- amount: monto más reciente en COP (número entero)
- cycle: "mensual" o "anual"
- lastCharge: fecha del último cargo YYYY-MM-DD

Devuelve ÚNICAMENTE un array JSON, sin texto adicional:
[{"name":"Netflix","amount":17900,"cycle":"mensual","lastCharge":"2025-03-15"},...]

Si no hay suscripciones devuelve: []`;

        let detected: Array<{
          name: string;
          amount: number;
          cycle: 'mensual' | 'anual';
          lastCharge?: string;
        }> = [];

        try {
          const r2 = await callClaude({
            messages: [{ role: 'user', content: analyzePrompt }],
          });
          detected = extractArray(r2) as typeof detected;
        } catch (err) {
          send({
            type: 'log',
            msg: `Error al analizar: ${err instanceof Error ? err.message : String(err)}`,
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
              : 'No se detectaron nuevas suscripciones.',
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
