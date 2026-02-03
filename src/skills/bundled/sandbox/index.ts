/**
 * Sandbox CLI Skill
 *
 * Commands:
 * /sandbox start - Start canvas sandbox
 * /sandbox push <html> - Push HTML to canvas
 * /sandbox reset - Reset canvas
 * /sandbox screenshot - Take screenshot
 * /sandbox status - Canvas status
 */

import type { CanvasService } from '../../../canvas/index';

let canvas: CanvasService | null = null;

async function getCanvas(): Promise<CanvasService> {
  if (canvas) return canvas;
  const { createCanvasService } = await import('../../../canvas/index');
  canvas = createCanvasService();
  return canvas;
}

async function execute(args: string): Promise<string> {
  const parts = args.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() || 'help';

  try {
    switch (cmd) {
      case 'start': {
        const c = await getCanvas();
        const url = await c.startServer();
        return `Canvas sandbox started at ${url}`;
      }

      case 'push': {
        const html = parts.slice(1).join(' ');
        if (!html) return 'Usage: /sandbox push <html>';
        const c = await getCanvas();
        const { components } = await import('../../../canvas/index');
        c.pushComponent(components.custom(html));
        return `Pushed HTML to canvas. ${c.getUrl() ? `View at ${c.getUrl()}` : 'Start server with `/sandbox start`.'}`;
      }

      case 'reset': {
        const c = await getCanvas();
        c.reset();
        return 'Canvas reset to blank state.';
      }

      case 'screenshot':
      case 'snap': {
        const c = await getCanvas();
        const buf = await c.snapshot();
        return `Screenshot captured (${(buf.length / 1024).toFixed(1)} KB).`;
      }

      case 'status': {
        const c = await getCanvas();
        const state = c.getState();
        const url = c.getUrl();
        let output = '**Canvas Sandbox Status**\n\n';
        output += `Server: ${url || 'not running'}\n`;
        output += `HTML: ${state.html ? `${state.html.length} chars` : 'empty'}\n`;
        output += `CSS: ${state.css ? `${state.css.length} chars` : 'none'}\n`;
        output += `JS eval: ${process.env.CANVAS_ALLOW_JS_EVAL === 'true' ? 'enabled' : 'disabled (CANVAS_ALLOW_JS_EVAL)'}\n`;
        output += `Unsafe sandbox: ${process.env.ALLOW_UNSAFE_SANDBOX === 'true' ? 'enabled' : 'disabled (ALLOW_UNSAFE_SANDBOX)'}`;
        return output;
      }

      default:
        return helpText();
    }
  } catch (error) {
    return `Sandbox error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function helpText(): string {
  return `**Sandbox Commands**

  /sandbox start                     - Start canvas sandbox
  /sandbox push <html>               - Push HTML to canvas
  /sandbox reset                     - Reset canvas
  /sandbox screenshot                - Take screenshot
  /sandbox status                    - Canvas status`;
}

export default {
  name: 'sandbox',
  description: 'Visual canvas sandbox for agent-driven UI and live previews',
  commands: ['/sandbox', '/canvas'],
  handle: execute,
};
