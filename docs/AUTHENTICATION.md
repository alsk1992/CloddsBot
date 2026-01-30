# Authentication Guide

Clodds supports multiple authentication methods for AI providers and external services.

## OAuth Authentication

The OAuth module (`src/auth/oauth.ts`) provides a unified interface for OAuth 2.0 authentication.

### Supported Providers

| Provider | Authorization Code | Device Code | Token Refresh |
|----------|-------------------|-------------|---------------|
| Anthropic | ✅ | ✅ | ✅ |
| OpenAI | ✅ | ✅ | ✅ |
| Google | ✅ | ✅ | ✅ |
| GitHub | ✅ | ✅ | ❌ |
| Azure AD | ✅ | ✅ | ✅ |

### Usage

```typescript
import { OAuthClient, interactiveOAuth, createAnthropicOAuth } from 'clodds/auth';

// Create provider-specific client
const client = createAnthropicOAuth('client-id', 'client-secret');

// Interactive authentication (CLI)
const tokens = await interactiveOAuth({
  provider: 'anthropic',
  clientId: 'your-client-id',
  scopes: ['api:read', 'api:write'],
});

// Get access token (auto-refreshes if expired)
const accessToken = await client.getAccessToken();

// Revoke tokens
await client.revokeTokens();
```

### Token Storage

Tokens are stored securely at `~/.clodds/tokens/<provider>.json` with `0600` permissions.

## GitHub Copilot Authentication

The Copilot module (`src/auth/copilot.ts`) handles GitHub Copilot API access.

### Setup

```typescript
import { CopilotAuthClient, interactiveCopilotAuth } from 'clodds/auth';

// Interactive device code flow
const tokens = await interactiveCopilotAuth();

// Or use client directly
const client = new CopilotAuthClient();
const { userCode, verificationUri } = await client.startDeviceCodeFlow();
console.log(`Visit ${verificationUri} and enter: ${userCode}`);
await client.pollDeviceCode(deviceCode, interval);
```

### Using Copilot API

```typescript
import { CopilotCompletionClient, CopilotAuthClient } from 'clodds/auth';

const auth = new CopilotAuthClient();
const copilot = new CopilotCompletionClient(auth);

// Code completion
const completion = await copilot.complete('function add(a, b) {');

// Chat completion
const response = await copilot.chat([
  { role: 'user', content: 'Explain this code...' }
], { model: 'gpt-4o' });
```

## Google/Gemini Authentication

The Google module (`src/auth/google.ts`) supports multiple authentication methods.

### API Key (Simplest)

```typescript
import { GeminiApiKeyManager, GeminiClient } from 'clodds/auth';

// Set API key
const keyManager = new GeminiApiKeyManager();
keyManager.setKey('your-api-key');

// Or use environment variable
// GOOGLE_API_KEY=xxx or GEMINI_API_KEY=xxx

const gemini = new GeminiClient();
const response = await gemini.generateContent('gemini-pro', 'Hello!');
```

### OAuth (User Authentication)

```typescript
import { GoogleAuthClient, interactiveGoogleAuth } from 'clodds/auth';

// Interactive device code flow
const tokens = await interactiveGoogleAuth();

// Or manual flow
const client = new GoogleAuthClient();
const { userCode, verificationUrl } = await client.startDeviceCodeFlow();
await client.pollDeviceCode(deviceCode, interval);
```

### Service Account (Server-to-Server)

```typescript
import { GoogleAuthClient } from 'clodds/auth';

const client = new GoogleAuthClient({
  serviceAccountPath: '/path/to/service-account.json',
});

// Access token is automatically obtained via JWT
const headers = await client.getGeminiHeaders();
```

## Qwen/DashScope Authentication

The Qwen module (`src/auth/qwen.ts`) handles Alibaba Cloud AI services.

### API Key

```typescript
import { QwenAuthClient, QwenClient } from 'clodds/auth';

// Set API key
const auth = new QwenAuthClient({ apiKey: 'your-key' });
// Or use environment: DASHSCOPE_API_KEY

const qwen = new QwenClient();
const response = await qwen.generate('qwen-turbo', 'Hello!');
```

### Alibaba Cloud Credentials

```typescript
import { QwenAuthClient } from 'clodds/auth';

const auth = new QwenAuthClient({
  accessKeyId: 'your-access-key',
  accessKeySecret: 'your-secret',
});

// Sign API requests
const signedParams = auth.signAliyunRequest('GET', url, params);
```

### STS Temporary Credentials

```typescript
const { accessKeyId, accessKeySecret, securityToken } = await auth.getSTSToken(
  'acs:ram::123456:role/MyRole',
  'clodds-session'
);
```

## CLI Commands

```bash
# OAuth login
clodds auth login anthropic
clodds auth login openai
clodds auth login google

# Copilot login
clodds auth copilot

# Check authentication status
clodds auth status

# Revoke all tokens
clodds auth logout
clodds auth logout anthropic
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GOOGLE_API_KEY` | Google/Gemini API key |
| `GEMINI_API_KEY` | Alternative for Google |
| `DASHSCOPE_API_KEY` | Qwen/DashScope API key |
| `QWEN_API_KEY` | Alternative for DashScope |
| `COPILOT_CLIENT_ID` | Custom Copilot OAuth client ID |

## Security Considerations

1. **Token Storage**: All tokens are stored with `0600` permissions (owner read/write only)
2. **Refresh**: Tokens are automatically refreshed before expiry
3. **PKCE**: OAuth flows use PKCE for enhanced security
4. **Revocation**: Always revoke tokens when no longer needed
