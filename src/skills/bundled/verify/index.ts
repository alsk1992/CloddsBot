/**
 * Verify CLI Skill - ERC-8004 Agent Identity Verification
 *
 * Commands:
 * /verify <id-or-address> - Verify agent identity
 * /verify trader <address> - Verify before copy trading
 * /verify register - Register your agent on-chain
 * /verify status - Verification status
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const erc8004 = await import('../../../identity/erc8004');

    switch (cmd) {
      case 'trader': {
        if (!parts[1]) return 'Usage: /verify trader <address>';
        const addr = parts[1];
        const has = await erc8004.hasIdentity(addr);
        if (has) {
          return `Trader ${addr} has a verified on-chain identity (ERC-8004).`;
        }
        return `WARNING: Trader ${addr} has NO on-chain identity. Copy trading unverified agents is risky.`;
      }

      case 'register': {
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
          return `**Registration requires PRIVATE_KEY**\n\nSet the PRIVATE_KEY environment variable to register your agent on-chain.`;
        }
        const client = erc8004.createERC8004Client('base', privateKey);
        const card = erc8004.buildAgentCard({
          name: 'clodds-agent',
          description: 'Clodds AI Trading Terminal agent',
        });
        const tokenURI = `data:application/json,${encodeURIComponent(JSON.stringify(card))}`;
        const result = await client.register(tokenURI);
        return `**Agent Registered**\n\nAgent ID: ${result.agentId}\nTx: ${result.txHash}\nNetwork: Base`;
      }

      case 'status':
        return `**Verification Status**\n\nRegistry: ERC-8004\nNetworks: ${Object.keys(erc8004.ERC8004_NETWORKS).join(', ')}\nIdentity contract: ${erc8004.ERC8004_CONTRACTS.identity}`;

      case 'lookup': {
        if (!parts[1]) return 'Usage: /verify lookup <agent-id>';
        const agentId = parseInt(parts[1]);
        if (isNaN(agentId)) return 'Agent ID must be a number.';
        const client = erc8004.createERC8004Client();
        const agent = await client.getAgent(agentId);
        if (!agent) return `Agent ${agentId} not found.`;
        const formatted = erc8004.formatAgentId(agentId);
        let output = `**Agent ${formatted}**\n\n`;
        output += `Owner: ${agent.owner}\n`;
        output += `Network: ${agent.network}\n`;
        if (agent.card) {
          output += `Name: ${agent.card.name}\n`;
          output += `Description: ${agent.card.description}\n`;
        }
        return output;
      }

      case 'parse': {
        if (!parts[1]) return 'Usage: /verify parse <formatted-id>';
        const parsed = erc8004.parseAgentId(parts[1]);
        if (!parsed) return 'Invalid agent ID format.';
        return `Parsed: agentId=${parsed.agentId}, chainId=${parsed.chainId}, registry=${parsed.registry}`;
      }

      case 'help':
        return helpText();

      default: {
        // Treat as address or ID to verify
        const target = parts[0];
        if (target?.startsWith('0x')) {
          const client = erc8004.createERC8004Client();
          const result = await client.verify(target);
          if (result.verified) {
            let output = `**Verified** ${target}\n\n`;
            output += `Agent ID: ${result.agentId}\n`;
            output += `Owner: ${result.owner}\n`;
            if (result.name) output += `Name: ${result.name}\n`;
            if (result.reputation) {
              output += `Reputation: ${result.reputation.averageScore.toFixed(1)}/5 (${result.reputation.feedbackCount} reviews)`;
            }
            return output;
          }
          return `Address ${target} has no ERC-8004 identity registered.`;
        }
        const parsed = erc8004.parseAgentId(target);
        if (parsed) {
          return `Agent ${parsed.agentId} on chain ${parsed.chainId} at registry ${parsed.registry}`;
        }
        return helpText();
      }
    }
  } catch (error) {
    return `Verify error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Verify Commands**

  /verify <address>                  - Verify agent by address
  /verify trader <address>           - Verify before copy trading
  /verify register                   - Register agent on-chain
  /verify status                     - Registry status
  /verify lookup <agent-id>          - Look up agent details
  /verify parse <formatted-id>       - Parse formatted agent ID

Uses ERC-8004 on-chain registry for cryptographic identity proof.`;
}

export default {
  name: 'verify',
  description: 'ERC-8004 on-chain agent identity verification to prevent impersonation',
  commands: ['/verify'],
  requires: { env: ['PRIVATE_KEY'] },
  handle: execute,
};
