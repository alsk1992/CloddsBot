/**
 * Identity CLI Skill
 *
 * Commands:
 * /identity lookup <agent-id|address> - Look up an agent identity
 * /identity register <token-uri> - Register a new agent identity
 * /identity verify <agent-id|address> - Full verification with reputation
 * /identity stats - Registry statistics
 */

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    const identityMod = await import('../../../identity/index');
    const network = (process.env.ERC8004_NETWORK as any) || 'base';

    switch (cmd) {
      case 'lookup':
      case 'get': {
        if (parts.length < 2) return 'Usage: /identity lookup <agent-id | 0xAddress>';
        const input = parts[1];

        const client = identityMod.createERC8004Client(network);

        // Determine if input is a numeric agent ID or an address
        if (/^\d+$/.test(input)) {
          const agentId = parseInt(input, 10);
          const agent = await client.getAgent(agentId);
          if (!agent) return `Agent ID ${agentId} not found on ${network}.`;

          let output = `**Agent #${agent.agentId}**\n\n`;
          output += `Owner: \`${agent.owner}\`\n`;
          output += `Network: ${agent.network} (chain ${agent.chainId})\n`;
          output += `Token URI: ${agent.tokenURI}\n`;
          if (agent.card) {
            output += `\n**Agent Card:**\n`;
            output += `  Name: ${agent.card.name}\n`;
            if (agent.card.description) output += `  Description: ${agent.card.description}\n`;
            if (agent.card.endpoints?.length) {
              output += `  Endpoints:\n`;
              for (const ep of agent.card.endpoints) {
                output += `    - ${ep.name}: ${ep.endpoint}\n`;
              }
            }
          }
          return output;
        } else {
          // Address lookup
          const agent = await client.getAgentByOwner(input);
          if (!agent) return `No agent identity found for address \`${input}\` on ${network}.`;

          let output = `**Agent #${agent.agentId}** (owned by \`${input}\`)\n\n`;
          output += `Network: ${agent.network} (chain ${agent.chainId})\n`;
          output += `Token URI: ${agent.tokenURI}\n`;
          if (agent.card) {
            output += `Name: ${agent.card.name}\n`;
            if (agent.card.description) output += `Description: ${agent.card.description}\n`;
          }
          return output;
        }
      }

      case 'register':
      case 'reg': {
        if (parts.length < 2) return 'Usage: /identity register <token-uri>\n\nRequires ERC8004_PRIVATE_KEY env var.';
        const tokenURI = parts[1];
        const privateKey = process.env.ERC8004_PRIVATE_KEY;

        if (!privateKey) {
          return 'Registration requires ERC8004_PRIVATE_KEY environment variable to be set.';
        }

        const client = identityMod.createERC8004Client(network, privateKey);
        const result = await client.register(tokenURI);

        let output = `**Agent Registered**\n\n`;
        output += `Agent ID: ${result.agentId}\n`;
        output += `Transaction: \`${result.txHash}\`\n`;
        output += `Network: ${network}\n`;
        output += `Formatted ID: ${identityMod.formatAgentId(result.agentId)}\n`;
        return output;
      }

      case 'verify':
      case 'check': {
        if (parts.length < 2) return 'Usage: /identity verify <agent-id | 0xAddress>';
        const input = parts[1];

        // Use the convenience function or full client
        let result;
        if (/^\d+$/.test(input)) {
          result = await identityMod.verifyAgent(parseInt(input, 10), network);
        } else {
          const client = identityMod.createERC8004Client(network);
          result = await client.verify(input);
        }

        let output = `**Verification Result**\n\n`;
        output += `Verified: ${result.verified ? 'Yes' : 'No'}\n`;
        if (result.agentId != null) output += `Agent ID: ${result.agentId}\n`;
        if (result.owner) output += `Owner: \`${result.owner}\`\n`;
        if (result.name) output += `Name: ${result.name}\n`;
        if (result.error) output += `Note: ${result.error}\n`;
        if (result.reputation) {
          output += `\n**Reputation:**\n`;
          output += `  Feedback count: ${result.reputation.feedbackCount}\n`;
          output += `  Average score: ${result.reputation.averageScore}/100\n`;
        }
        return output;
      }

      case 'has':
      case 'exists': {
        if (parts.length < 2) return 'Usage: /identity has <0xAddress>';
        const address = parts[1];
        const has = await identityMod.hasIdentity(address, network);
        return has
          ? `Address \`${address}\` **has** a registered agent identity on ${network}.`
          : `Address \`${address}\` does **not** have a registered agent identity on ${network}.`;
      }

      case 'reputation':
      case 'rep': {
        if (parts.length < 2) return 'Usage: /identity reputation <agent-id>';
        const agentId = parseInt(parts[1], 10);
        if (isNaN(agentId)) return 'Agent ID must be a number.';

        const client = identityMod.createERC8004Client(network);
        const rep = await client.getReputation(agentId);
        if (!rep) return `No reputation data for agent #${agentId}.`;

        let output = `**Reputation for Agent #${agentId}**\n\n`;
        output += `Feedback count: ${rep.feedbackCount}\n`;
        output += `Average score: ${rep.averageScore}/100\n`;
        return output;
      }

      case 'stats':
      case 'total': {
        const client = identityMod.createERC8004Client(network);
        const total = await client.getTotalAgents();
        return `**ERC-8004 Registry Stats** (${network})\n\nTotal registered agents: ${total}\nContract: \`${identityMod.ERC8004_CONTRACTS.identity}\``;
      }

      case 'format': {
        if (parts.length < 2) return 'Usage: /identity format <agent-id>';
        const agentId = parseInt(parts[1], 10);
        if (isNaN(agentId)) return 'Agent ID must be a number.';
        return `Formatted: \`${identityMod.formatAgentId(agentId)}\``;
      }

      case 'parse': {
        if (parts.length < 2) return 'Usage: /identity parse <eip155:chainId:registry:agentId>';
        const parsed = identityMod.parseAgentId(parts[1]);
        if (!parsed) return `Could not parse "${parts[1]}". Expected format: eip155:<chainId>:<registry>:<agentId>`;
        return `**Parsed Agent ID**\n\nChain ID: ${parsed.chainId}\nRegistry: \`${parsed.registry}\`\nAgent ID: ${parsed.agentId}`;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Identity Commands** (ERC-8004)

  /identity lookup <id|address>      - Look up agent identity
  /identity register <token-uri>     - Register new agent (needs key)
  /identity verify <id|address>      - Full verification + reputation
  /identity has <address>            - Check if address has identity
  /identity reputation <id>          - Get reputation score
  /identity stats                    - Registry statistics
  /identity format <id>              - Format agent ID (EIP-155)
  /identity parse <formatted>        - Parse formatted agent ID

Set ERC8004_NETWORK env var (default: base). Set ERC8004_PRIVATE_KEY for registration.`;
}

export default {
  name: 'identity',
  description: 'ERC-8004 agent identity lookup, registration, and verification',
  commands: ['/identity', '/id'],
  handle: execute,
};
