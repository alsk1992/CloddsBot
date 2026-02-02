/**
 * Tweet Ideas Generator Skill
 *
 * Generate tweet ideas from:
 * - Market trends and crypto news
 * - Project updates (CHANGELOG, README, features)
 *
 * Stores user's voice/style preference.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { generateId } from '../../../utils/id';
import { logger } from '../../../utils/logger';

// =============================================================================
// TYPES
// =============================================================================

interface TweetDraft {
  id: string;
  content: string;
  charCount: number;
  type: 'trend' | 'project' | 'spicy' | 'feature' | 'changelog';
  createdAt: Date;
  topic?: string;
}

interface ProjectInfo {
  name: string;
  version: string;
  description: string;
  changelog: string[];
  readme: string;
}

// =============================================================================
// STORAGE
// =============================================================================

const drafts = new Map<string, TweetDraft>();
let userStyle = '';

// =============================================================================
// HELPERS
// =============================================================================

function parseChangelog(content: string, limit = 5): string[] {
  const lines = content.split('\n');
  const entries: string[] = [];
  let currentEntry = '';
  let inEntry = false;
  let count = 0;

  for (const line of lines) {
    // New version entry
    if (line.startsWith('## [')) {
      if (currentEntry && count < limit) {
        entries.push(currentEntry.trim());
        count++;
      }
      currentEntry = line;
      inEntry = true;
    } else if (inEntry && line.startsWith('## ')) {
      // Next major section, stop
      break;
    } else if (inEntry) {
      currentEntry += '\n' + line;
    }
  }

  // Don't forget last entry
  if (currentEntry && count < limit) {
    entries.push(currentEntry.trim());
  }

  return entries;
}

function readProjectInfo(projectPath: string): ProjectInfo | null {
  try {
    const info: ProjectInfo = {
      name: '',
      version: '',
      description: '',
      changelog: [],
      readme: '',
    };

    // Read package.json
    const pkgPath = join(projectPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      info.name = pkg.name || '';
      info.version = pkg.version || '';
      info.description = pkg.description || '';
    }

    // Read CHANGELOG.md
    const changelogPath = join(projectPath, 'CHANGELOG.md');
    if (existsSync(changelogPath)) {
      const changelog = readFileSync(changelogPath, 'utf-8');
      info.changelog = parseChangelog(changelog, 3);
    }

    // Read README.md (first 1500 chars)
    const readmePath = join(projectPath, 'README.md');
    if (existsSync(readmePath)) {
      const readme = readFileSync(readmePath, 'utf-8');
      info.readme = readme.slice(0, 1500);
    }

    return info;
  } catch (error) {
    logger.error({ error, projectPath }, 'Failed to read project info');
    return null;
  }
}

function getTrends(): string[] {
  // In a real implementation, this would pull from:
  // - Crypto news feeds
  // - Market movers
  // - Social signals
  // For now, return placeholder trends
  return [
    'Bitcoin ETF flows hitting records',
    'Solana memecoin season',
    'AI agents getting wallets',
    'Base chain growth',
    'Prediction markets going mainstream',
    'DeFi yields compressing',
    'L2 wars heating up',
  ];
}

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

function buildTrendPrompt(style: string, topic?: string): string {
  const trends = getTrends();
  const trendList = trends.map((t, i) => `${i + 1}. ${t}`).join('\n');

  return `You are a tweet ghostwriter. Generate 4 tweet ideas.

USER'S STYLE: ${style || 'casual, insightful, no emojis'}

${topic ? `TOPIC: ${topic}` : `CURRENT TRENDS:\n${trendList}`}

RULES:
- Each tweet MUST be under 280 characters
- Match the user's style exactly
- No hashtags unless style demands it
- Be authentic, not corporate
- Each tweet should be standalone
- Include character count for each

Format each as:
[1] <tweet text>
(X chars)

[2] <tweet text>
(X chars)

etc.`;
}

function buildSpicyPrompt(style: string): string {
  const trends = getTrends();

  return `You are a tweet ghostwriter for CONTRARIAN takes. Generate 4 provocative tweet ideas.

USER'S STYLE: ${style || 'provocative, short sentences, question everything'}

CURRENT NARRATIVES TO CHALLENGE:
${trends.map((t, i) => `${i + 1}. ${t}`).join('\n')}

RULES:
- Each tweet MUST be under 280 characters
- Go AGAINST the grain - challenge consensus
- Be provocative but not offensive
- Short, punchy sentences work best
- No hedging - commit to the take
- Include character count

Format each as:
[1] <tweet text>
(X chars)

[2] <tweet text>
(X chars)`;
}

function buildProjectPrompt(style: string, project: ProjectInfo): string {
  const latestChanges = project.changelog[0] || 'No changelog found';

  return `You are a tweet ghostwriter for a developer announcing project updates.

USER'S STYLE: ${style || 'builder energy, technical but accessible'}

PROJECT: ${project.name} v${project.version}
DESCRIPTION: ${project.description}

LATEST CHANGES:
${latestChanges}

Generate 4 tweet ideas announcing this update. RULES:
- Each tweet MUST be under 280 characters
- Match the user's style
- Focus on what's NEW and why it matters
- Don't oversell - be authentic
- One tweet can tease a thread
- Include character count

Format each as:
[1] <tweet text>
(X chars)

[2] <tweet text>
(X chars)`;
}

function buildFeaturePrompt(style: string, feature: string): string {
  return `You are a tweet ghostwriter announcing a new feature.

USER'S STYLE: ${style || 'builder energy, technical but accessible'}

FEATURE: ${feature}

Generate 4 tweet ideas announcing this feature. RULES:
- Each tweet MUST be under 280 characters
- Match the user's style
- Explain what it does and why it matters
- Be specific, not vague
- Include character count

Format each as:
[1] <tweet text>
(X chars)

[2] <tweet text>
(X chars)`;
}

function buildLaunchPrompt(style: string, project: ProjectInfo): string {
  return `You are a tweet ghostwriter for a product launch thread.

USER'S STYLE: ${style || 'builder sharing their work, authentic not hype'}

PROJECT: ${project.name}
DESCRIPTION: ${project.description}

README EXCERPT:
${project.readme}

Generate a 5-tweet thread announcing this launch. RULES:
- Tweet 1: Hook - what is this and why should anyone care
- Tweet 2: The problem it solves
- Tweet 3: Key features (pick 3-4 best)
- Tweet 4: Technical credibility (what's under the hood)
- Tweet 5: CTA - where to get it
- Each tweet under 280 chars
- Match user's style
- No cringe, no "excited to announce", be real

Format as:
[1/5] <tweet>
(X chars)

[2/5] <tweet>
(X chars)

etc.`;
}

// =============================================================================
// HANDLERS
// =============================================================================

function handleGenerate(topic?: string): string {
  const prompt = buildTrendPrompt(userStyle, topic);
  return `**Generate tweet ideas**\n\n${prompt}`;
}

function handleSpicy(): string {
  const prompt = buildSpicyPrompt(userStyle);
  return `**Generate contrarian takes**\n\n${prompt}`;
}

function handleProject(projectPath: string): string {
  const project = readProjectInfo(projectPath);
  if (!project) {
    return `Could not read project at: ${projectPath}`;
  }

  const prompt = buildProjectPrompt(userStyle, project);
  return `**Generate project update tweets**\n\n${prompt}`;
}

function handleChangelog(changelogPath: string): string {
  if (!existsSync(changelogPath)) {
    return `Changelog not found: ${changelogPath}`;
  }

  const content = readFileSync(changelogPath, 'utf-8');
  const entries = parseChangelog(content, 1);

  if (entries.length === 0) {
    return 'No changelog entries found.';
  }

  const prompt = `You are a tweet ghostwriter announcing a changelog update.

USER'S STYLE: ${userStyle || 'builder energy, ship fast'}

LATEST CHANGELOG:
${entries[0]}

Generate 4 tweet ideas for this release. Keep under 280 chars each. Match the style.

Format each as:
[1] <tweet text>
(X chars)`;

  return `**Generate changelog announcement**\n\n${prompt}`;
}

function handleFeature(feature: string): string {
  const prompt = buildFeaturePrompt(userStyle, feature);
  return `**Generate feature announcement**\n\n${prompt}`;
}

function handleLaunch(projectPath: string): string {
  const project = readProjectInfo(projectPath);
  if (!project) {
    return `Could not read project at: ${projectPath}`;
  }

  const prompt = buildLaunchPrompt(userStyle, project);
  return `**Generate launch thread**\n\n${prompt}`;
}

function handleStyle(styleDesc: string): string {
  if (!styleDesc) {
    if (userStyle) {
      return `Current style: "${userStyle}"`;
    }
    return 'No style set. Use `/tweets style <description>` to set one.';
  }

  userStyle = styleDesc;
  return `Style set: "${styleDesc}"\n\nThis will be used for all tweet generation.`;
}

function handleTrends(): string {
  const trends = getTrends();
  const list = trends.map((t, i) => `${i + 1}. ${t}`).join('\n');

  return `**Current Trends**\n\n${list}\n\nUse \`/tweets generate <topic>\` to riff on any of these.`;
}

function handleDrafts(): string {
  if (drafts.size === 0) {
    return 'No saved drafts. Use `/tweets save <content>` after generating.';
  }

  const list = Array.from(drafts.values())
    .map((d) => `**${d.id}** (${d.charCount} chars, ${d.type})\n${d.content}`)
    .join('\n\n');

  return `**Saved Drafts**\n\n${list}`;
}

function handleSave(content: string): string {
  const draft: TweetDraft = {
    id: generateId().slice(0, 8),
    content,
    charCount: content.length,
    type: 'trend',
    createdAt: new Date(),
  };

  drafts.set(draft.id, draft);
  return `Saved draft: ${draft.id}`;
}

function handleClear(): string {
  const count = drafts.size;
  drafts.clear();
  return `Cleared ${count} drafts.`;
}

// =============================================================================
// SKILL EXPORT
// =============================================================================

export const skill = {
  name: 'tweet-ideas',
  description: 'Generate tweet ideas from trends and project updates',
  commands: [
    {
      name: 'tweets',
      description: 'Generate tweet ideas',
      usage: '/tweets [generate|spicy|project|changelog|feature|launch|style|trends|drafts|save|clear] [args]',
    },
  ],

  async handler(args: string): Promise<string> {
    const parts = args.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const rest = parts.slice(1).join(' ');

    switch (command) {
      case 'generate':
        return handleGenerate(rest || undefined);

      case 'spicy':
        return handleSpicy();

      case 'project':
        if (!rest) {
          return 'Usage: /tweets project <path>';
        }
        return handleProject(rest);

      case 'changelog':
        if (!rest) {
          return 'Usage: /tweets changelog <path>';
        }
        return handleChangelog(rest);

      case 'feature':
        if (!rest) {
          return 'Usage: /tweets feature <description>';
        }
        return handleFeature(rest);

      case 'launch':
        if (!rest) {
          return 'Usage: /tweets launch <project-path>';
        }
        return handleLaunch(rest);

      case 'style':
        return handleStyle(rest);

      case 'trends':
        return handleTrends();

      case 'drafts':
        return handleDrafts();

      case 'save':
        if (!rest) {
          return 'Usage: /tweets save <content>';
        }
        return handleSave(rest);

      case 'clear':
        return handleClear();

      default:
        // No command = generate
        if (args.trim()) {
          return handleGenerate(args.trim());
        }
        return `**Tweet Ideas Generator**

Commands:
\`/tweets generate [topic]\` - Generate from trends
\`/tweets spicy\` - Contrarian takes
\`/tweets project <path>\` - Project updates
\`/tweets changelog <path>\` - Announce changelog
\`/tweets feature <desc>\` - Announce feature
\`/tweets launch <path>\` - Launch thread
\`/tweets style <desc>\` - Set your voice
\`/tweets trends\` - Show trends
\`/tweets drafts\` - View saved
\`/tweets save <content>\` - Save draft
\`/tweets clear\` - Clear drafts`;
    }
  },
};

export default skill;
