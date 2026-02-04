/**
 * Credentials Handlers
 *
 * Setup and management of trading platform credentials
 */

import type { ToolInput, HandlerResult, HandlersMap, HandlerContext } from './types';
import { errorResult, successResult } from './types';
import type { Platform, PolymarketCredentials, KalshiCredentials, ManifoldCredentials } from '../../types';
import { normalizeKalshiPrivateKey } from '../../utils/kalshi-auth';

// =============================================================================
// CREDENTIALS SETUP HANDLERS
// =============================================================================

async function setupPolymarketCredentialsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId || !context.credentials) {
    return errorResult('User context not available');
  }

  // signatureType: 0=EOA (direct wallet), 1=POLY_PROXY (Magic Link), 2=POLY_GNOSIS_SAFE (MetaMask/browser)
  const sigType = toolInput.signature_type != null ? Number(toolInput.signature_type) : undefined;

  const creds: PolymarketCredentials = {
    privateKey: toolInput.private_key as string,
    funderAddress: toolInput.funder_address as string,
    apiKey: toolInput.api_key as string,
    apiSecret: toolInput.api_secret as string,
    apiPassphrase: toolInput.api_passphrase as string,
    signatureType: sigType,
  };

  await context.credentials.setCredentials(context.userId, 'polymarket', creds);

  return successResult({
    result: 'Polymarket credentials saved! You can now trade on Polymarket.',
    wallet: creds.funderAddress,
    security_notice: 'Your credentials are encrypted and stored securely. For maximum security, consider using a dedicated trading wallet with limited funds. Never share your private key with anyone else.',
  });
}

async function setupKalshiCredentialsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId || !context.credentials) {
    return errorResult('User context not available');
  }

  const apiKeyId = toolInput.api_key_id as string;
  const privateKeyPem = toolInput.private_key_pem as string;

  if (!apiKeyId || !privateKeyPem) {
    return errorResult('Kalshi credentials require api_key_id and private_key_pem.');
  }

  const creds: KalshiCredentials = {
    apiKeyId,
    privateKeyPem: normalizeKalshiPrivateKey(privateKeyPem),
  };

  await context.credentials.setCredentials(context.userId, 'kalshi', creds);

  return successResult({
    result: 'Kalshi credentials saved! You can now trade on Kalshi.',
    security_notice: 'Your credentials are encrypted and stored securely. Keep your private key safe and rotate it if compromised.',
  });
}

async function setupManifoldCredentialsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId || !context.credentials) {
    return errorResult('User context not available');
  }

  const creds: ManifoldCredentials = {
    apiKey: toolInput.api_key as string,
  };

  await context.credentials.setCredentials(context.userId, 'manifold', creds);

  return successResult({
    result: 'Manifold credentials saved! You can now bet on Manifold.',
    security_notice: 'Your API key is encrypted and stored securely. You can regenerate your API key on Manifold settings if needed.',
  });
}

async function listTradingCredentialsHandler(
  _toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId || !context.credentials) {
    return errorResult('User context not available');
  }

  const platforms = await context.credentials.listUserPlatforms(context.userId);

  if (platforms.length === 0) {
    return successResult({
      result: 'No trading credentials set up yet. Use setup_polymarket_credentials, setup_kalshi_credentials, or setup_manifold_credentials to enable trading.',
    });
  }

  return successResult({
    result: `Trading enabled for: ${platforms.join(', ')}`,
    platforms,
  });
}

async function deleteTradingCredentialsHandler(
  toolInput: ToolInput,
  context: HandlerContext
): Promise<HandlerResult> {
  if (!context.userId || !context.credentials) {
    return errorResult('User context not available');
  }

  const platform = toolInput.platform as Platform;
  await context.credentials.deleteCredentials(context.userId, platform);

  return successResult({
    result: `Deleted ${platform} credentials.`,
  });
}

// =============================================================================
// EXPORT HANDLERS MAP
// =============================================================================

export const credentialsHandlers: HandlersMap = {
  setup_polymarket_credentials: setupPolymarketCredentialsHandler,
  setup_kalshi_credentials: setupKalshiCredentialsHandler,
  setup_manifold_credentials: setupManifoldCredentialsHandler,
  list_trading_credentials: listTradingCredentialsHandler,
  delete_trading_credentials: deleteTradingCredentialsHandler,
};

export default credentialsHandlers;
