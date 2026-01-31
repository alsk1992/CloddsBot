/**
 * Opinion.trade API authentication helpers.
 * Opinion uses a simple API key header pattern.
 */

export interface OpinionApiAuth {
  /** API key for Opinion.trade */
  apiKey: string;
}

/**
 * Build headers for Opinion.trade API requests.
 * Opinion uses a simple 'apikey' header for authentication.
 */
export function buildOpinionHeaders(auth: OpinionApiAuth): Record<string, string> {
  return {
    'apikey': auth.apiKey,
    'Content-Type': 'application/json',
  };
}

/**
 * Build WebSocket connection URL with API key.
 */
export function buildOpinionWsUrl(auth: OpinionApiAuth): string {
  return `wss://ws.opinion.trade?apikey=${encodeURIComponent(auth.apiKey)}`;
}
