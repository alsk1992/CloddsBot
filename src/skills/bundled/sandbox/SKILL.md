---
name: sandbox
description: "Push HTML content to a live-updating canvas server for visual dashboards, charts, and agent-driven UI previews. Use when users want to render HTML, take screenshots, or preview content in a browser canvas."
commands:
  - /sandbox
  - /canvas
---

# Sandbox - Visual Canvas

Push HTML content to a live-updating canvas server for visual previews, dashboards, and agent-driven UI.

## Commands

```
/sandbox start        - Start the canvas server (returns URL)
/sandbox push <html>  - Push HTML content to the canvas
/sandbox reset        - Reset canvas to blank state
/sandbox screenshot   - Take a screenshot of the current canvas
/sandbox status       - Show canvas server status and settings
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CANVAS_ALLOW_JS_EVAL` | Enable JavaScript evaluation in canvas (default: `false`) |
| `ALLOW_UNSAFE_SANDBOX` | Enable unsafe sandbox mode (default: `false`) |

## Examples

```
/sandbox start
/sandbox push <h1>Hello World</h1><p>Live preview</p>
/sandbox screenshot
/sandbox status
/sandbox reset
```

## How It Works

1. `/sandbox start` launches a local HTTP server that serves the canvas page
2. `/sandbox push <html>` sends HTML to the canvas, rendered in real time
3. `/sandbox screenshot` captures the current canvas state as an image
4. `/sandbox reset` clears all HTML, CSS, and JS from the canvas
5. `/sandbox status` shows whether the server is running, the URL, and content sizes
