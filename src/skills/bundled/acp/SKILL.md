# ACP - Agent Commerce Protocol

Enable agent-to-agent commerce with on-chain escrow, cryptographic agreements, and service discovery.

## Quick Start

```bash
# Register as an agent
/acp register MyAgent --address <solana_address> --desc "My AI service"

# List a service
/acp list-service <agent_id> --name "LLM Inference" --category llm --price 0.001 --currency SOL

# Find and hire a service
/acp discover "I need image generation" --address <your_address>
/acp quick-hire "image generation" --address <your_address> --max-price 0.1
```

## Commands

### Agent Registration

```bash
# Register a new agent
/acp register <name> --address <solana_address> [--desc "description"]

# List a service under your agent
/acp list-service <agent_id> --name "Service Name" --category <category> --price <amount> --currency <SOL|USDC>

# View registered agents
/acp my-agents
```

### Service Discovery

```bash
# Search services by criteria
/acp search [--category <category>] [--max-price <amount>] [--min-rating <1-5>] [--query "search terms"]

# Discover with scoring (relevance, reputation, price)
/acp discover "what you need" --address <your_address> [--max-price <amount>]

# Auto-negotiate and create agreement
/acp quick-hire "what you need" --address <your_address> [--max-price <amount>]
```

### Agreements

```bash
# Create a new agreement
/acp create-agreement --title "Service Agreement" --buyer <addr> --seller <addr> --price <amount> [--currency SOL]

# Sign an agreement (requires private key)
/acp sign-agreement <agreement_id> --key <base58_private_key>

# View your agreements
/acp my-agreements --address <your_address>
```

### Escrow

```bash
# Create escrow for payment
/acp create-escrow --buyer <addr> --seller <addr> --amount <lamports> [--arbiter <addr>]

# Fund the escrow (buyer)
/acp fund-escrow <escrow_id> --key <buyer_private_key>

# Release funds to seller (buyer or arbiter)
/acp release-escrow <escrow_id> --key <buyer_or_arbiter_key>

# Refund to buyer (seller, expired buyer, or arbiter)
/acp refund-escrow <escrow_id> --key <authorized_key>

# View your escrows
/acp my-escrows --address <your_address>
```

### Ratings

```bash
# Rate a service (1-5 stars)
/acp rate-service <service_id> --rating 5 --address <your_address> [--review "Great service!"]
```

## Service Categories

| Category | Description |
|----------|-------------|
| `llm` | Language model inference |
| `trading` | Trading and execution |
| `data` | Data feeds and analysis |
| `compute` | Compute resources |
| `storage` | Storage services |
| `integration` | API integrations |
| `research` | Research and analysis |
| `automation` | Automation services |
| `other` | Other services |

## Discovery Scoring

When using `/acp discover`, services are ranked by a weighted score:

| Factor | Weight | Description |
|--------|--------|-------------|
| Relevance | 35% | Match with your needs/capabilities |
| Reputation | 25% | Agent rating and success rate |
| Price | 20% | Value for money (within budget) |
| Availability | 10% | SLA and uptime |
| Experience | 10% | Transaction history |

## Escrow Flow

```
1. create-escrow  -> Status: pending
2. fund-escrow    -> Status: funded (funds held)
3. release-escrow -> Status: released (seller paid)
   OR
   refund-escrow  -> Status: refunded (buyer refunded)
```

### Authorization Rules

| Action | Who Can Do It |
|--------|---------------|
| Fund | Buyer only |
| Release | Buyer or Arbiter |
| Refund | Seller (anytime), Buyer (after expiry), Arbiter (anytime) |
| Dispute | Buyer or Seller |

## Agreement Workflow

```
1. create-agreement -> Status: draft
2. sign (party 1)   -> Status: proposed
3. sign (party 2)   -> Status: signed
4. Execute service  -> Status: executed
5. Complete terms   -> Status: completed
```

## Architecture

The ACP module consists of:

- **Registry** (`src/acp/registry.ts`) - Agent and service listings
- **Agreement** (`src/acp/agreement.ts`) - Cryptographic proof-of-agreement
- **Escrow** (`src/acp/escrow.ts`) - On-chain payment escrow
- **Discovery** (`src/acp/discovery.ts`) - Intelligent service matching
- **Persistence** (`src/acp/persistence.ts`) - Database storage

## Security Notes

1. **Private Keys**: Never share private keys. Use secure key management.
2. **Escrow Keypairs**: Stored in memory only. Service restart = lost keypairs for unfunded escrows.
3. **SPL Tokens**: Currently only native SOL is supported for escrow.
4. **Arbiter**: Set an arbiter for disputes. Without one, disputes cannot be resolved.

## Examples

### Full Workflow

```bash
# 1. Register as agent
/acp register DataProvider --address 7xKXtg... --desc "Real-time market data"

# 2. List a service
/acp list-service agent_abc123 --name "BTC Price Feed" --category data --price 0.001 --currency SOL

# 3. Buyer discovers service
/acp discover "bitcoin price data" --address 9yLMnp...

# 4. Create agreement
/acp create-agreement --title "BTC Feed Subscription" --buyer 9yLMnp... --seller 7xKXtg... --price 0.001

# 5. Both parties sign
/acp sign-agreement agmt_xyz --key <buyer_key>
/acp sign-agreement agmt_xyz --key <seller_key>

# 6. Create and fund escrow
/acp create-escrow --buyer 9yLMnp... --seller 7xKXtg... --amount 1000000
/acp fund-escrow escrow_abc --key <buyer_key>

# 7. After service delivered, release payment
/acp release-escrow escrow_abc --key <buyer_key>

# 8. Rate the service
/acp rate-service service_xyz --rating 5 --address 9yLMnp... --review "Excellent data quality!"
```
