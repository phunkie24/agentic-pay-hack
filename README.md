# Agentic Pay

> Autonomous AI agents discovering, negotiating, and exchanging value through BSV micro-payments — solving real-world data exchange at scale.

**BSV Association — Open Run Agentic Pay Hackathon 2026**

---

## What it does

Agentic Pay is a multi-agent system where 5 specialised AI agents autonomously:
1. **Discover** each other via BRC-100 identity (no hardcoded addresses)
2. **Negotiate** service prices using Chain-of-Thought reasoning
3. **Execute** BSV micro-payments for each data query answered
4. **Validate** every transaction for safety and correctness
5. **Learn** from outcomes to improve future pricing decisions

**Real-world problem solved:** Agent-to-agent data marketplace — AI agents pay each other for knowledge retrieval services (RAG queries), creating a self-sustaining micro-economy of information exchange.

---

## Architecture

```
Human UI (Next.js)
       │
Orchestrator Agent  ←──── Planning + Goal monitoring + Exception recovery
       │
  ┌────┴──────────────────────────────────┐
  │          Agent Communication Bus       │
  │    (Redis pub/sub + A2A HTTP/SSE)      │
  └──┬─────┬──────┬────────┬─────────┬───┘
     │     │      │        │         │
Discovery  Neg.  Payment  Knowledge  Validator
(BRC-100) (CoT)  (batch   (RAG +    (Reflection
          A2A    BSV tx)   Memory)   + Guardrails)
                   │
            BSV Blockchain
         (1.5M+ tx / 24hr)
```

## Tech Stack (all open source)

| Layer | Technology |
|---|---|
| Language | TypeScript / Node.js 20+ |
| BSV | `@bsv/sdk` · `@bsv/simple` · `@bsv/simple-mcp` · `@bsv/wallet-toolbox` |
| AI / LLM | Anthropic Claude (claude-sonnet-4-6) |
| Frontend | Next.js 14 + WebSocket real-time feed |
| Memory | Redis (short-term) · ChromaDB (RAG long-term) |
| Monitoring | Prometheus · Grafana · OpenTelemetry |
| Infra | Docker Compose (dev) · Azure Container Apps (prod) |
| CI/CD | GitHub Actions |

---

## Quick Start

### Prerequisites
- Node.js 20+
- Docker + Docker Compose
- Anthropic API key

### 1. Clone & install
```bash
git clone https://github.com/your-org/agentic-pay
cd agentic-pay
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY at minimum
```

### 3. Generate agent wallets
```bash
npm run setup:wallets
# Copies generated keys into .env.wallets — merge into .env
```

### 4. Fund testnet wallets
```bash
npm run fund:testnet
# Visit faucet URLs printed, fund the PAYMENT agent wallet
```

### 5. Start everything
```bash
npm run dev
# Starts: Redis, ChromaDB, Postgres, 6 agents, MCP server, API, UI, Prometheus, Grafana
```

### 6. Open the dashboard
- **UI:** http://localhost:3002
- **API:** http://localhost:3010/api/metrics
- **MCP:** http://localhost:3001
- **Grafana:** http://localhost:3003 (admin/admin)

---

## Project Structure

```
agentic-pay/
├── agents/
│   ├── orchestrator/     # Planning + routing + exception recovery
│   ├── discovery/        # BRC-100 agent discovery
│   ├── negotiation/      # CoT-based price negotiation
│   ├── payment/          # BSV batch micro-payments (1.5M tx/24hr)
│   ├── knowledge/        # RAG + ChromaDB long-term memory
│   └── validator/        # Reflection + guardrails + HITL
├── mcp-server/           # @bsv/simple-mcp tool server
├── ui/
│   ├── src/pages/        # Next.js dashboard
│   └── src/server/       # Fastify API + WebSocket
├── shared/
│   ├── types/            # TypeScript interfaces
│   ├── utils/            # wallet-manager, event-bus, llm-client
│   └── constants/        # ports, negotiation params, payment targets
├── infra/
│   ├── docker/           # Dockerfiles + Compose
│   └── azure/            # Bicep IaC for production
├── scripts/
│   ├── setup-wallets.ts  # Generate BRC-100 agent keys
│   └── fund-testnet.ts   # Check/fund testnet wallets
└── .github/workflows/    # CI/CD pipeline
```

---

## Hitting 1.5M Transactions

The Payment Agent uses parallelized batch processing (Pattern Ch.3):
- 100 outputs per BSV transaction (BSV supports large tx)
- 500ms batch interval → ~120 batch tx/min
- Each output = one meaningful knowledge query payment
- At 100 outputs/tx × 120 tx/min × 60 min × 24hr = **17.28M potential outputs**

All transactions are **meaningful**: each micro-payment (10 sats) represents a real RAG query answered by the Knowledge Agent, logged in ChromaDB, and validated by the Validator Agent.

---

## Team

| Name | Role |
|---|---|
| Funke | AI/ML Engineer · Data Engineer · Architect |

**Solo Builder category submission**

---

## On-chain Verification

All transactions are verifiable on BSV testnet:
- Explorer: https://test.whatsonchain.com
- ARC broadcaster: https://arc.taal.com

---

## License

MIT — Open source, built on open-source BSV tooling.
