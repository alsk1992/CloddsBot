/**
 * Markdown Module - Clawdbot-style message formatting
 *
 * Features:
 * - Convert markdown to platform-specific formats
 * - Strip markdown for plain text
 * - Escape/unescape for different platforms
 * - Code block handling
 * - Link formatting
 */

// =============================================================================
// TYPES
// =============================================================================

export type Platform = 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'plain' | 'html';

export interface FormatOptions {
  /** Strip all formatting */
  stripAll?: boolean;
  /** Preserve code blocks */
  preserveCode?: boolean;
  /** Max length (truncate) */
  maxLength?: number;
  /** Link handling */
  links?: 'keep' | 'strip' | 'text-only';
}

// =============================================================================
// PATTERNS
// =============================================================================

const PATTERNS = {
  // Inline formatting
  bold: /\*\*(.+?)\*\*/g,
  italic: /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g,
  italicAlt: /_(.+?)_/g,
  strikethrough: /~~(.+?)~~/g,
  code: /`([^`]+)`/g,

  // Block elements
  codeBlock: /```(\w*)\n?([\s\S]*?)```/g,
  blockquote: /^> (.+)$/gm,
  heading: /^(#{1,6}) (.+)$/gm,

  // Links and images
  link: /\[([^\]]+)\]\(([^)]+)\)/g,
  image: /!\[([^\]]*)\]\(([^)]+)\)/g,
  autoLink: /<(https?:\/\/[^>]+)>/g,

  // Lists
  unorderedList: /^[\*\-\+] (.+)$/gm,
  orderedList: /^\d+\. (.+)$/gm,

  // Horizontal rule
  hr: /^(?:---|\*\*\*|___)$/gm,
};

// =============================================================================
// CONVERTERS
// =============================================================================

/** Convert markdown to Telegram MarkdownV2 */
function toTelegram(text: string): string {
  let result = text;

  // Escape special characters first
  result = result.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');

  // Then apply formatting (unescaping what we need)
  result = result
    .replace(/\\\*\\\*(.+?)\\\*\\\*/g, '*$1*') // Bold
    .replace(/\\\_(.+?)\\\_{1}/g, '_$1_') // Italic
    .replace(/\\~\\~(.+?)\\~\\~/g, '~$1~') // Strikethrough
    .replace(/\\`([^`]+)\\`/g, '`$1`') // Code
    .replace(/\\`\\`\\`(\w*)\n?([\s\S]*?)\\`\\`\\`/g, '```$1\n$2```'); // Code block

  return result;
}

/** Convert markdown to Discord format */
function toDiscord(text: string): string {
  // Discord uses standard markdown, minimal changes needed
  return text;
}

/** Convert markdown to Slack mrkdwn */
function toSlack(text: string): string {
  let result = text;

  // Bold: ** -> *
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Italic: * or _ -> _
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');

  // Strikethrough: ~~ -> ~
  result = result.replace(/~~(.+?)~~/g, '~$1~');

  // Links: [text](url) -> <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Code blocks stay the same

  return result;
}

/** Convert markdown to WhatsApp format */
function toWhatsApp(text: string): string {
  let result = text;

  // Bold: ** -> *
  result = result.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Italic: * or _ -> _
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '_$1_');

  // Strikethrough stays ~~

  // Code: ` -> ```
  result = result.replace(/`([^`]+)`/g, '```$1```');

  // Links: just URL
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  return result;
}

/** Convert markdown to HTML */
function toHtml(text: string): string {
  let result = text;

  // Escape HTML first
  result = result
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (before other formatting)
  result = result.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Inline code
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Links
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Headings
  result = result.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  result = result.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  result = result.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  result = result.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  result = result.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  result = result.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Blockquotes
  result = result.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

  // Lists
  result = result.replace(/^[\*\-\+] (.+)$/gm, '<li>$1</li>');
  result = result.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Line breaks
  result = result.replace(/\n/g, '<br>');

  return result;
}

/** Strip all markdown formatting */
function stripMarkdown(text: string): string {
  let result = text;

  // Code blocks - keep content
  result = result.replace(/```\w*\n?([\s\S]*?)```/g, '$1');

  // Inline code
  result = result.replace(/`([^`]+)`/g, '$1');

  // Bold and italic
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');

  // Strikethrough
  result = result.replace(/~~(.+?)~~/g, '$1');

  // Links - keep text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Images - keep alt text
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Headings
  result = result.replace(/^#{1,6} /gm, '');

  // Blockquotes
  result = result.replace(/^> /gm, '');

  // Lists
  result = result.replace(/^[\*\-\+] /gm, '');
  result = result.replace(/^\d+\. /gm, '');

  // Horizontal rules
  result = result.replace(/^(?:---|\*\*\*|___)$/gm, '');

  return result.trim();
}

// =============================================================================
// PUBLIC API
// =============================================================================

/** Convert markdown to platform-specific format */
export function formatForPlatform(text: string, platform: Platform, options: FormatOptions = {}): string {
  if (options.stripAll) {
    return stripMarkdown(text);
  }

  let result: string;

  switch (platform) {
    case 'telegram':
      result = toTelegram(text);
      break;
    case 'discord':
      result = toDiscord(text);
      break;
    case 'slack':
      result = toSlack(text);
      break;
    case 'whatsapp':
      result = toWhatsApp(text);
      break;
    case 'html':
      result = toHtml(text);
      break;
    case 'plain':
    default:
      result = stripMarkdown(text);
      break;
  }

  // Handle links
  if (options.links === 'strip') {
    result = result.replace(PATTERNS.link, '$1');
    result = result.replace(/<[^>]+\|([^>]+)>/g, '$1'); // Slack links
    result = result.replace(/<a[^>]*>([^<]*)<\/a>/g, '$1'); // HTML links
  } else if (options.links === 'text-only') {
    result = result.replace(PATTERNS.link, '$1');
  }

  // Truncate if needed
  if (options.maxLength && result.length > options.maxLength) {
    result = result.slice(0, options.maxLength - 3) + '...';
  }

  return result;
}

/** Strip all markdown formatting */
export function strip(text: string): string {
  return stripMarkdown(text);
}

/** Escape text for a platform */
export function escape(text: string, platform: Platform): string {
  switch (platform) {
    case 'telegram':
      return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    case 'html':
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    case 'slack':
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    default:
      return text;
  }
}

/** Unescape text from a platform */
export function unescape(text: string, platform: Platform): string {
  switch (platform) {
    case 'telegram':
      return text.replace(/\\([_*\[\]()~`>#+\-=|{}.!\\])/g, '$1');
    case 'html':
      return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    case 'slack':
      return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
    default:
      return text;
  }
}

/** Extract code blocks from markdown */
export function extractCodeBlocks(text: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  let match;

  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    });
  }

  return blocks;
}

/** Extract links from markdown */
export function extractLinks(text: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  let match;

  const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
  while ((match = regex.exec(text)) !== null) {
    links.push({
      text: match[1],
      url: match[2],
    });
  }

  return links;
}

/** Check if text contains markdown */
export function hasMarkdown(text: string): boolean {
  return (
    PATTERNS.bold.test(text) ||
    PATTERNS.italic.test(text) ||
    PATTERNS.code.test(text) ||
    PATTERNS.codeBlock.test(text) ||
    PATTERNS.link.test(text) ||
    PATTERNS.heading.test(text)
  );
}

/** Truncate text preserving markdown structure */
export function truncate(text: string, maxLength: number, suffix = '...'): string {
  if (text.length <= maxLength) return text;

  // Try to break at word boundary
  let truncated = text.slice(0, maxLength - suffix.length);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.7) {
    truncated = truncated.slice(0, lastSpace);
  }

  // Close any open code blocks
  const openBlocks = (truncated.match(/```/g) || []).length;
  if (openBlocks % 2 !== 0) {
    truncated += '\n```';
  }

  return truncated + suffix;
}
