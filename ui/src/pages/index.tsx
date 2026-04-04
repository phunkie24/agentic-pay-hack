// ui/src/pages/index.tsx
import { useEffect, useState, useRef } from 'react';

interface AgentStatus {
  role: string;
  status: 'online' | 'offline' | 'ok';
  identityKey?: string;
  totalTxLogged?: number;
  discoveredCount?: number;
  activeNegotiations?: number;
  validatedCount?: number;
}

interface AgentEvent {
  id: string;
  agentRole: string;
  eventType: string;
  summary: string;
  txid?: string;
  timestamp: number;
}

interface Metrics {
  totalTransactions: number;
  transactions24h: number;
  progressPct: string;
  targetTx24h: number;
  passRate: number;
}

const ROLE_COLOR: Record<string, string> = {
  orchestrator: '#6C5CE7',
  discovery:    '#00B894',
  negotiation:  '#0984E3',
  payment:      '#E17055',
  knowledge:    '#A29BFE',
  validator:    '#FDCB6E',
};

const ROLE_ICON: Record<string, string> = {
  orchestrator: '🎯',
  discovery:    '🔍',
  negotiation:  '🤝',
  payment:      '💸',
  knowledge:    '🧠',
  validator:    '✅',
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3010';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:3010/ws';

const fetchOpts: RequestInit = {
  headers: { 'ngrok-skip-browser-warning': 'true' },
};

export default function Dashboard() {
  const [agents, setAgents]     = useState<AgentStatus[]>([]);
  const [events, setEvents]     = useState<AgentEvent[]>([]);
  const [metrics, setMetrics]   = useState<Metrics | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchAll();
    const poll = setInterval(fetchAll, 8000);

    function connect() {
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen  = () => setConnected(true);
        ws.onclose = () => { setConnected(false); setTimeout(connect, 5000); };
        ws.onerror = () => ws.close();
        ws.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data);
            if (data.type === 'update') {
              if (data.events?.length) setEvents(prev => [...data.events, ...prev].slice(0, 200));
              if (data.metrics) setMetrics(prev => ({ ...prev, ...data.metrics } as Metrics));
              setLastUpdate(Date.now());
            }
          } catch { /* ignore */ }
        };
      } catch { /* WS not available, polling only */ }
    }
    connect();

    return () => { clearInterval(poll); wsRef.current?.close(); };
  }, []);

  async function fetchAll() {
    await Promise.allSettled([fetchAgents(), fetchMetrics(), fetchEvents()]);
  }

  async function fetchAgents() {
    const resp = await fetch(`${API}/api/agents`, fetchOpts).catch(() => null);
    if (!resp?.ok) return;
    const data = await resp.json() as any;
    setAgents(data.agents ?? []);
  }

  async function fetchMetrics() {
    const resp = await fetch(`${API}/api/metrics`, fetchOpts).catch(() => null);
    if (!resp?.ok) return;
    const data = await resp.json() as any;
    setMetrics(data);
    setLastUpdate(Date.now());
  }

  async function fetchEvents() {
    const resp = await fetch(`${API}/api/events`, fetchOpts).catch(() => null);
    if (!resp?.ok) return;
    const data = await resp.json() as any;
    setEvents(data.events ?? []);
  }

  const progress = metrics ? Math.min(100, parseFloat(metrics.progressPct)) : 0;
  const onlineCount = agents.filter(a => a.status === 'online' || a.status === 'ok').length;
  const isLive = connected || (lastUpdate > 0 && Date.now() - lastUpdate < 30000);

  return (
    <div style={{ background: '#0A0C14', minHeight: '100vh', color: '#ECEFF4', fontFamily: '"Courier New", monospace', padding: '20px 28px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, background: 'linear-gradient(90deg,#6C5CE7,#00B894)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            ◈ Agentic Pay
          </h1>
          <p style={{ margin: '4px 0 0', color: '#636E82', fontSize: 12 }}>
            Multi-agent BSV payment system · Autonomous agent-to-agent value exchange
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          <div style={{
            padding: '5px 14px', borderRadius: 20, fontSize: 12,
            background: isLive ? '#0D2517' : '#1A0A0A',
            border: `1px solid ${isLive ? '#00B894' : '#D63031'}`,
            color: isLive ? '#00B894' : '#D63031',
          }}>
            {isLive ? '● Live' : '○ Connecting...'}
          </div>
          {lastUpdate > 0 && (
            <div style={{ fontSize: 10, color: '#636E82' }}>
              updated {new Date(lastUpdate).toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: 'Total Transactions', value: (metrics?.totalTransactions ?? 0).toLocaleString(), color: '#6C5CE7', icon: '⟳' },
          { label: 'Transactions (24h)',  value: (metrics?.transactions24h ?? 0).toLocaleString(),  color: '#00B894', icon: '📈' },
          { label: 'Target Progress',    value: `${metrics?.progressPct ?? '0.0'}%`,               color: '#E17055', icon: '🎯' },
          { label: 'Validation Pass Rate', value: `${metrics?.passRate ?? 100}%`,                  color: '#FDCB6E', icon: '✅' },
        ].map(({ label, value, color, icon }) => (
          <div key={label} style={{ background: '#111420', border: `1px solid #1E2235`, borderRadius: 10, padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', right: 14, top: 12, fontSize: 20, opacity: 0.15 }}>{icon}</div>
            <div style={{ fontSize: 10, color: '#636E82', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 'bold', color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Progress Bar ── */}
      <div style={{ background: '#111420', border: '1px solid #1E2235', borderRadius: 10, padding: '12px 18px', marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11 }}>
          <span style={{ color: '#636E82' }}>24-hour transaction target</span>
          <span style={{ color: '#00B894' }}>
            {(metrics?.transactions24h ?? 0).toLocaleString()} / {(1_500_000).toLocaleString()}
          </span>
        </div>
        <div style={{ background: '#1E2235', borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 6,
            background: 'linear-gradient(90deg,#6C5CE7,#00B894)',
            width: `${progress}%`, transition: 'width 1.2s ease',
          }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>

        {/* ── Agent Status ── */}
        <div style={{ background: '#111420', border: '1px solid #1E2235', borderRadius: 10, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 13, color: '#ECEFF4', textTransform: 'uppercase', letterSpacing: 1 }}>Agent Status</h2>
            <span style={{ fontSize: 11, color: '#00B894' }}>{onlineCount}/{agents.length} online</span>
          </div>
          {agents.length === 0 ? (
            <div style={{ color: '#636E82', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
              Polling agents...
            </div>
          ) : (
            agents.map((agent) => (
              <div key={agent.role} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 12px', marginBottom: 6, borderRadius: 8,
                background: '#0A0C14',
                borderLeft: `3px solid ${agent.status !== 'offline' ? (ROLE_COLOR[agent.role] ?? '#636E82') : '#2E3250'}`,
                opacity: agent.status !== 'offline' ? 1 : 0.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{ROLE_ICON[agent.role] ?? '🤖'}</span>
                  <div>
                    <div style={{ color: ROLE_COLOR[agent.role] ?? '#8892A0', fontWeight: 'bold', fontSize: 12 }}>
                      {agent.role}
                    </div>
                    {agent.identityKey && (
                      <div style={{ fontSize: 9, color: '#3A4A5A', marginTop: 1, fontFamily: 'monospace' }}>
                        {agent.identityKey.slice(0, 18)}…
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 10, color: '#636E82', lineHeight: '16px' }}>
                  {agent.discoveredCount    != null && <div>found {agent.discoveredCount}</div>}
                  {agent.activeNegotiations != null && <div>{agent.activeNegotiations} negotiating</div>}
                  {agent.totalTxLogged      != null && <div>{agent.totalTxLogged} tx</div>}
                  {agent.validatedCount     != null && <div>{agent.validatedCount} validated</div>}
                  <div style={{ color: agent.status !== 'offline' ? '#00B894' : '#D63031', marginTop: 2 }}>
                    {agent.status !== 'offline' ? '● online' : '○ offline'}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Live Event Feed ── */}
        <div style={{ background: '#111420', border: '1px solid #1E2235', borderRadius: 10, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ margin: 0, fontSize: 13, color: '#ECEFF4', textTransform: 'uppercase', letterSpacing: 1 }}>Live Agent Activity</h2>
            <span style={{ fontSize: 11, color: '#636E82' }}>{events.length} events</span>
          </div>
          <div style={{ maxHeight: 500, overflowY: 'auto', paddingRight: 4 }}>
            {events.length === 0 ? (
              <div style={{ color: '#636E82', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
                Waiting for agent events…
              </div>
            ) : (
              events.slice(0, 60).map((ev, i) => (
                <div key={ev.id ?? i} style={{
                  padding: '8px 10px', marginBottom: 5, borderRadius: 6,
                  background: '#0A0C14',
                  borderLeft: `3px solid ${ROLE_COLOR[ev.agentRole] ?? '#2E3250'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: ROLE_COLOR[ev.agentRole] ?? '#8892A0', fontWeight: 'bold' }}>
                      {ROLE_ICON[ev.agentRole] ?? '•'} {ev.agentRole}
                    </span>
                    <span style={{ fontSize: 9, color: '#3A4A5A' }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: '#C8D0DC' }}>{ev.summary}</div>
                  {ev.txid && (
                    <div style={{ fontSize: 9, color: '#3A4A5A', marginTop: 2, fontFamily: 'monospace' }}>
                      txid: {ev.txid.slice(0, 20)}…
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', marginTop: 24, fontSize: 10, color: '#2E3250' }}>
        Agentic Pay · BSV Blockchain Hackathon · Open-source multi-agent payment system
      </div>
    </div>
  );
}
