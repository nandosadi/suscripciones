'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';

/* ─── Types ─────────────────────────────────────────────── */

interface Subscription {
  id: string;
  name: string;
  amount: number;
  cycle: 'mensual' | 'anual' | 'semanal';
  lastCharge?: string;
  confirmedAt: string;
}

interface PendingItem {
  id: string;
  name: string;
  amount: number;
  cycle: 'mensual' | 'anual' | 'semanal';
  lastCharge?: string;
}

interface LogEntry {
  id: string;
  msg: string;
  level: 'info' | 'ok' | 'err';
}

/* ─── Helpers ────────────────────────────────────────────── */

const PALETTE = ['#E78258', '#8CB5B0', '#ECC768', '#9DB89A', '#C98B8B', '#A89BC4'];

function accentFor(name: string): string {
  const h = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return PALETTE[h % PALETTE.length];
}

function abbrFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function toMonthly(s: Subscription): number {
  if (s.cycle === 'anual') return s.amount / 12;
  if (s.cycle === 'semanal') return s.amount * 4.33;
  return s.amount;
}

function cop(n: number): string {
  return Math.round(n).toLocaleString('es-CO');
}

const STORAGE_KEY = 'nandologia-v1';

/* ─── Sub-components ─────────────────────────────────────── */

function SummaryCard({
  label,
  value,
  unit,
  delay = 0,
}: {
  label: string;
  value: string;
  unit: string;
  delay?: number;
}) {
  return (
    <div
      style={{
        ...s.card,
        animation: `fadeUp 0.5s ease ${delay}ms both`,
      }}
    >
      <div style={s.cardLabel}>{label}</div>
      <div style={s.cardValue}>{value}</div>
      <div style={s.cardUnit}>{unit}</div>
    </div>
  );
}

function SubCard({
  sub,
  onDelete,
  index,
}: {
  sub: Subscription;
  onDelete: () => void;
  index: number;
}) {
  const color = accentFor(sub.name);
  const monthly = toMonthly(sub);

  return (
    <div
      className="sub-card"
      style={{
        ...s.subCard,
        animation: `fadeUp 0.4s ease ${index * 55}ms both`,
      }}
    >
      <div
        style={{
          ...s.abbr,
          background: color + '1A',
          border: `1px solid ${color}33`,
          color,
        }}
      >
        {abbrFor(sub.name)}
      </div>

      <div style={s.subInfo}>
        <div style={s.subName}>{sub.name}</div>
        <span style={s.cyclePill}>{sub.cycle}</span>
      </div>

      <div style={s.subRight}>
        <div style={s.subAmount}>${cop(sub.amount)}</div>
        <div style={s.subAmountSub}>
          {sub.cycle !== 'mensual' ? `~$${cop(monthly)}/mes` : 'COP/mes'}
        </div>
      </div>

      <button
        className="delete-btn"
        onClick={onDelete}
        title="Eliminar"
        style={s.deleteBtn}
      >
        ×
      </button>
    </div>
  );
}

function LogStrip({ logs, endRef }: { logs: LogEntry[]; endRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div style={s.logWrap}>
      <div style={s.logHeader}>REGISTRO DE SINCRONIZACIÓN</div>
      <div style={s.logBody}>
        {logs.map((l) => (
          <div
            key={l.id}
            style={{ ...s.logRow, animation: 'logSlide 0.2s ease both' }}
          >
            <span
              style={{
                ...s.logDot,
                color:
                  l.level === 'ok'
                    ? '#9DB89A'
                    : l.level === 'err'
                    ? '#C98B8B'
                    : '#8CB5B0',
              }}
            >
              ●
            </span>
            <span style={s.logMsg}>{l.msg}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────── */

export default function Home() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  /* localStorage */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSubs(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  }, [subs]);

  /* Auto-scroll log */
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  function addLog(msg: string, level: LogEntry['level'] = 'info') {
    setLogs((prev) => [...prev, { id: crypto.randomUUID(), msg, level }]);
  }

  /* Google OAuth popup */
  const connectGoogle = useCallback(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      addLog('NEXT_PUBLIC_GOOGLE_CLIENT_ID no está configurado en Vercel', 'err');
      return;
    }
    const redirect = `${window.location.origin}/oauth/callback`;
    const scope = 'https://www.googleapis.com/auth/gmail.readonly';
    const url =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirect)}` +
      `&response_type=token` +
      `&scope=${encodeURIComponent(scope)}`;

    const popup = window.open(url, 'google-oauth', 'width=500,height=620,left=200,top=80');

    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'google-token' && e.data.token) {
        setGoogleToken(e.data.token);
        window.removeEventListener('message', handler);
        popup?.close();
      }
    };
    window.addEventListener('message', handler);
  }, []);

  /* Sync */
  const handleSync = useCallback(async () => {
    if (!googleToken) {
      addLog('Conecta Gmail primero', 'err');
      return;
    }
    if (syncing) return;

    setSyncing(true);
    setLogs([]);
    setPending([]);

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingNames: subs.map((s) => s.name),
          googleToken,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line);
            if (evt.type === 'log') {
              addLog(evt.msg, evt.level ?? 'info');
            } else if (evt.type === 'done') {
              const items: PendingItem[] = (evt.items ?? []).map(
                (item: Omit<PendingItem, 'id'>) => ({
                  ...item,
                  id: crypto.randomUUID(),
                })
              );
              setPending(items);
            }
          } catch {}
        }
      }
    } catch (err) {
      addLog(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
        'err'
      );
    } finally {
      setSyncing(false);
    }
  }, [googleToken, syncing, subs]);

  /* Confirm / ignore */
  function confirmItem(id: string) {
    const item = pending.find((p) => p.id === id);
    if (!item) return;
    setSubs((prev) => [
      ...prev,
      { ...item, confirmedAt: new Date().toISOString() },
    ]);
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  function ignoreItem(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  function confirmAll() {
    const now = new Date().toISOString();
    setSubs((prev) => [
      ...prev,
      ...pending.map((p) => ({ ...p, confirmedAt: now })),
    ]);
    setPending([]);
  }

  function ignoreAll() {
    setPending([]);
  }

  function deleteSub(id: string) {
    setSubs((prev) => prev.filter((s) => s.id !== id));
  }

  /* Derived */
  const monthly = subs.reduce((sum, s) => sum + toMonthly(s), 0);
  const yearly = monthly * 12;
  const showLog = logs.length > 0;

  /* ── Render ── */
  return (
    <div style={s.root}>
      <div style={s.bgLines} aria-hidden />

      <div style={s.container}>
        {/* ── Header ── */}
        <header style={s.header}>
          <div>
            <p style={s.wordmark}>Nandología</p>
            <h1 style={s.title}>Mis Suscripciones</h1>
            <p style={s.subtitle}>
              Rastreador de gastos recurrentes · Bancolombia vía Gmail
            </p>
          </div>
          <div style={s.headerRule} />
        </header>

        {/* ── Summary ── */}
        <div style={s.summaryRow}>
          <SummaryCard
            label="Total mensual"
            value={`$${cop(monthly)}`}
            unit="COP / mes"
            delay={0}
          />
          <SummaryCard
            label="Proyección anual"
            value={`$${cop(yearly)}`}
            unit="COP / año"
            delay={80}
          />
          <SummaryCard
            label="Suscripciones"
            value={String(subs.length)}
            unit="activas"
            delay={160}
          />
        </div>

        {/* ── Controls ── */}
        <div style={s.controls}>
          <div style={s.gmailStatus}>
            <div
              style={{
                ...s.dot,
                background: googleToken ? '#9DB89A' : 'rgba(248,245,243,0.2)',
                boxShadow: googleToken
                  ? '0 0 6px rgba(157,184,154,0.5)'
                  : 'none',
              }}
            />
            <span style={s.statusTxt}>
              {googleToken ? 'Gmail conectado' : 'Gmail no conectado'}
            </span>
          </div>

          <div style={s.btnRow}>
            {!googleToken ? (
              <button
                className="btn-secondary"
                onClick={connectGoogle}
                style={s.btnSecondary}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M20.283 10.356h-8.327v3.451h4.792c-.446 2.193-2.313 3.453-4.792 3.453a5.27 5.27 0 0 1-5.279-5.28 5.27 5.27 0 0 1 5.279-5.279c1.259 0 2.397.447 3.29 1.178l2.6-2.599c-1.584-1.381-3.615-2.233-5.89-2.233a8.908 8.908 0 0 0-8.934 8.934 8.908 8.908 0 0 0 8.934 8.934c4.467 0 8.529-3.249 8.529-8.934 0-.528-.081-1.097-.202-1.625z" fill="currentColor"/>
                </svg>
                Conectar Gmail
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={handleSync}
                disabled={syncing}
                style={{
                  ...s.btnPrimary,
                  ...(syncing
                    ? { animation: 'syncPulse 1.4s ease-in-out infinite', cursor: 'not-allowed' }
                    : {}),
                }}
              >
                {syncing ? 'Sincronizando…' : '⟳ Sincronizar Gmail'}
              </button>
            )}
          </div>
        </div>

        {/* ── Log strip ── */}
        {showLog && (
          <div style={{ animation: 'fadeIn 0.3s ease both' }}>
            <LogStrip logs={logs} endRef={logEndRef} />
          </div>
        )}

        {/* ── Pending ── */}
        {pending.length > 0 && (
          <section style={{ ...s.section, animation: 'fadeUp 0.4s ease both' }}>
            <div style={s.secHeader}>
              <div style={s.secTitle}>
                <span style={{ ...s.secDot, background: '#ECC768' }} />
                Pendientes de confirmación ({pending.length})
              </div>
              <div style={s.bulkRow}>
                <button
                  className="btn-bulk-confirm"
                  onClick={confirmAll}
                  style={s.btnBulkConfirm}
                >
                  ✓ Confirmar todas
                </button>
                <button
                  className="btn-bulk-ignore"
                  onClick={ignoreAll}
                  style={s.btnBulkIgnore}
                >
                  ✗ Ignorar todas
                </button>
              </div>
            </div>

            <div style={s.pendingList}>
              {pending.map((item, i) => {
                const color = accentFor(item.name);
                return (
                  <div
                    key={item.id}
                    style={{
                      ...s.pendingRow,
                      animation: `fadeUp 0.3s ease ${i * 50}ms both`,
                    }}
                  >
                    <div
                      style={{
                        ...s.abbr,
                        width: 36,
                        height: 36,
                        borderRadius: 6,
                        fontSize: 11,
                        background: color + '1A',
                        border: `1px solid ${color}33`,
                        color,
                      }}
                    >
                      {abbrFor(item.name)}
                    </div>

                    <div style={s.subInfo}>
                      <div style={s.subName}>{item.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                        <span style={s.cyclePill}>{item.cycle}</span>
                        {item.lastCharge && (
                          <span style={s.lastCharge}>último: {item.lastCharge}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ ...s.subAmount, marginRight: 8 }}>
                      ${cop(item.amount)}
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="btn-confirm"
                        onClick={() => confirmItem(item.id)}
                        style={s.btnConfirm}
                        title="Confirmar"
                      >
                        ✓
                      </button>
                      <button
                        className="btn-ignore"
                        onClick={() => ignoreItem(item.id)}
                        style={s.btnIgnore}
                        title="Ignorar"
                      >
                        ✗
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Dashboard ── */}
        {subs.length > 0 ? (
          <section style={s.section}>
            <div style={s.secHeader}>
              <div style={s.secTitle}>
                <span style={{ ...s.secDot, background: '#8CB5B0' }} />
                Suscripciones activas
              </div>
            </div>
            <div style={s.grid}>
              {subs.map((sub, i) => (
                <SubCard
                  key={sub.id}
                  sub={sub}
                  onDelete={() => deleteSub(sub.id)}
                  index={i}
                />
              ))}
            </div>
          </section>
        ) : (
          !showLog && (
            <div style={s.empty}>
              <div style={s.emptyGlyph}>∅</div>
              <div style={s.emptyTitle}>Sin suscripciones registradas</div>
              <p style={s.emptyBody}>
                Conecta Gmail y sincroniza para detectar automáticamente tus
                suscripciones desde las notificaciones de transacción de
                Bancolombia.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ─── Styles ─────────────────────────────────────────────── */

const s: Record<string, CSSProperties> = {
  root: {
    background: '#1A1410',
    color: '#F8F5F3',
    minHeight: '100vh',
    fontFamily: "var(--font-syne), 'Syne', system-ui, sans-serif",
    position: 'relative',
    overflowX: 'hidden',
  },

  bgLines: {
    position: 'fixed',
    inset: 0,
    pointerEvents: 'none',
    zIndex: 0,
  },

  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '52px 28px 96px',
    position: 'relative',
    zIndex: 1,
  },

  /* Header */
  header: {
    marginBottom: 44,
  },

  wordmark: {
    fontFamily: "var(--font-syne), sans-serif",
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.22em',
    color: '#E78258',
    textTransform: 'uppercase',
    marginBottom: 14,
  },

  title: {
    fontFamily: "var(--font-syne), sans-serif",
    fontSize: 42,
    fontWeight: 700,
    letterSpacing: '-0.025em',
    color: '#F8F5F3',
    lineHeight: 1.08,
    marginBottom: 10,
  },

  subtitle: {
    fontSize: 13,
    color: 'rgba(248,245,243,0.38)',
    letterSpacing: '0.01em',
    marginBottom: 32,
  },

  headerRule: {
    height: 1,
    background:
      'linear-gradient(90deg, rgba(231,130,88,0.35) 0%, rgba(248,245,243,0.06) 60%, transparent 100%)',
  },

  /* Summary */
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
    marginBottom: 40,
  },

  card: {
    background: '#231C16',
    border: '1px solid rgba(248,245,243,0.07)',
    borderRadius: 8,
    padding: '22px 24px',
  },

  cardLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.16em',
    color: 'rgba(248,245,243,0.35)',
    textTransform: 'uppercase',
    marginBottom: 12,
  },

  cardValue: {
    fontFamily: "var(--font-dm-mono), 'DM Mono', monospace",
    fontSize: 30,
    fontWeight: 500,
    color: '#ECC768',
    letterSpacing: '-0.025em',
    lineHeight: 1,
    marginBottom: 5,
  },

  cardUnit: {
    fontFamily: "var(--font-dm-mono), monospace",
    fontSize: 11,
    color: 'rgba(248,245,243,0.3)',
  },

  /* Controls */
  controls: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    gap: 16,
    flexWrap: 'wrap',
  },

  gmailStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
    transition: 'all 0.3s',
  },

  statusTxt: {
    fontFamily: "var(--font-dm-mono), monospace",
    fontSize: 12,
    color: 'rgba(248,245,243,0.45)',
  },

  btnRow: {
    display: 'flex',
    gap: 10,
  },

  btnPrimary: {
    background: '#E78258',
    color: '#1A1410',
    border: 'none',
    borderRadius: 6,
    padding: '11px 22px',
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.02em',
    cursor: 'pointer',
    transition: 'opacity 0.15s, transform 0.1s',
  },

  btnSecondary: {
    background: 'transparent',
    color: '#8CB5B0',
    border: '1px solid rgba(140,181,176,0.28)',
    borderRadius: 6,
    padding: '11px 20px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    transition: 'all 0.2s',
  },

  /* Log strip */
  logWrap: {
    background: '#0E0B09',
    border: '1px solid rgba(248,245,243,0.06)',
    borderRadius: 7,
    marginBottom: 36,
    overflow: 'hidden',
  },

  logHeader: {
    padding: '8px 16px',
    background: '#1A1410',
    borderBottom: '1px solid rgba(248,245,243,0.05)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.16em',
    color: 'rgba(248,245,243,0.28)',
    fontFamily: "var(--font-dm-mono), monospace",
  },

  logBody: {
    padding: '14px 16px',
    maxHeight: 210,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },

  logRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 9,
    fontFamily: "var(--font-dm-mono), monospace",
    fontSize: 12,
  },

  logDot: {
    fontSize: 7,
    lineHeight: '19px',
    flexShrink: 0,
  },

  logMsg: {
    color: 'rgba(248,245,243,0.65)',
    lineHeight: '19px',
  },

  /* Sections */
  section: {
    marginBottom: 44,
  },

  secHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },

  secTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.16em',
    color: 'rgba(248,245,243,0.45)',
    textTransform: 'uppercase',
  },

  secDot: {
    width: 6,
    height: 6,
    borderRadius: 2,
    flexShrink: 0,
  },

  bulkRow: {
    display: 'flex',
    gap: 8,
  },

  btnBulkConfirm: {
    background: 'rgba(157,184,154,0.1)',
    color: '#9DB89A',
    border: '1px solid rgba(157,184,154,0.22)',
    borderRadius: 5,
    padding: '6px 13px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },

  btnBulkIgnore: {
    background: 'rgba(201,139,139,0.08)',
    color: '#C98B8B',
    border: '1px solid rgba(201,139,139,0.2)',
    borderRadius: 5,
    padding: '6px 13px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'background 0.15s',
  },

  /* Pending rows */
  pendingList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  pendingRow: {
    background: '#231C16',
    border: '1px solid rgba(236,199,104,0.12)',
    borderRadius: 8,
    padding: '13px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },

  /* Subscription cards */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))',
    gap: 10,
  },

  subCard: {
    background: '#231C16',
    border: '1px solid rgba(248,245,243,0.07)',
    borderRadius: 8,
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    transition: 'border-color 0.2s',
  },

  /* Shared: abbr circle */
  abbr: {
    width: 40,
    height: 40,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 800,
    flexShrink: 0,
    fontFamily: "var(--font-syne), sans-serif",
  },

  /* Shared: info column */
  subInfo: {
    flex: 1,
    minWidth: 0,
  },

  subName: {
    fontSize: 14,
    fontWeight: 600,
    color: '#F8F5F3',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },

  cyclePill: {
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: '#8CB5B0',
    background: 'rgba(140,181,176,0.1)',
    border: '1px solid rgba(140,181,176,0.2)',
    borderRadius: 3,
    padding: '2px 6px',
    textTransform: 'uppercase',
    fontFamily: "var(--font-syne), sans-serif",
    marginTop: 4,
  },

  lastCharge: {
    fontFamily: "var(--font-dm-mono), monospace",
    fontSize: 10,
    color: 'rgba(248,245,243,0.3)',
  },

  /* Amount */
  subRight: {
    textAlign: 'right',
    flexShrink: 0,
  },

  subAmount: {
    fontFamily: "var(--font-dm-mono), 'DM Mono', monospace",
    fontSize: 16,
    fontWeight: 500,
    color: '#ECC768',
    letterSpacing: '-0.015em',
    lineHeight: 1,
    marginBottom: 3,
  },

  subAmountSub: {
    fontFamily: "var(--font-dm-mono), monospace",
    fontSize: 10,
    color: 'rgba(248,245,243,0.3)',
  },

  /* Confirm / ignore buttons */
  btnConfirm: {
    width: 32,
    height: 32,
    background: 'rgba(157,184,154,0.12)',
    color: '#9DB89A',
    border: '1px solid rgba(157,184,154,0.24)',
    borderRadius: 4,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
    flexShrink: 0,
  },

  btnIgnore: {
    width: 32,
    height: 32,
    background: 'rgba(201,139,139,0.08)',
    color: '#C98B8B',
    border: '1px solid rgba(201,139,139,0.2)',
    borderRadius: 4,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s',
    flexShrink: 0,
  },

  deleteBtn: {
    width: 28,
    height: 28,
    background: 'transparent',
    color: 'rgba(248,245,243,0.22)',
    border: '1px solid rgba(248,245,243,0.08)',
    borderRadius: 4,
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    lineHeight: 1,
    transition: 'all 0.15s',
  },

  /* Empty state */
  empty: {
    textAlign: 'center',
    padding: '84px 24px',
    animation: 'fadeUp 0.55s ease 0.2s both',
  },

  emptyGlyph: {
    fontFamily: "var(--font-dm-mono), monospace",
    fontSize: 52,
    color: 'rgba(248,245,243,0.08)',
    marginBottom: 20,
    lineHeight: 1,
  },

  emptyTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'rgba(248,245,243,0.35)',
    marginBottom: 10,
  },

  emptyBody: {
    fontSize: 13,
    color: 'rgba(248,245,243,0.22)',
    maxWidth: 360,
    margin: '0 auto',
    lineHeight: 1.65,
  },
};
