/**
 * API Gateway Module Tests
 *
 * Unit tests for HTTP routing, authentication, and rate limiting.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { createMockHttpClient } from '../../mocks';
import http from 'http';

// =============================================================================
// TEST UTILITIES
// =============================================================================

interface TestResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

async function makeRequest(
  port: number,
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              headers[key] = value;
            }
          }

          try {
            resolve({
              status: res.statusCode || 500,
              headers,
              body: data ? JSON.parse(data) : {},
            });
          } catch {
            resolve({
              status: res.statusCode || 500,
              headers,
              body: data,
            });
          }
        });
      }
    );

    req.on('error', reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

// =============================================================================
// GATEWAY CREATION TESTS
// =============================================================================

describe('createApiGateway', () => {
  const { createApiGateway } = require('../../../src/api/gateway');

  it('should create gateway with default config', () => {
    const gateway = createApiGateway();

    assert.ok(gateway, 'Should create gateway');
    assert.ok(gateway.start, 'Should have start method');
    assert.ok(gateway.stop, 'Should have stop method');
    assert.ok(gateway.getUrl, 'Should have getUrl method');
    assert.ok(gateway.getMetrics, 'Should have getMetrics method');
  });

  it('should accept custom port', () => {
    const gateway = createApiGateway({ port: 4000 });

    assert.ok(gateway.getUrl().includes('4000'));
  });

  it('should return correct URL', () => {
    const gateway = createApiGateway({ port: 3001, host: '0.0.0.0' });
    const url = gateway.getUrl();

    assert.ok(url.includes('localhost'));
    assert.ok(url.includes('3001'));
  });

  it('should expose component getters', () => {
    const gateway = createApiGateway();

    assert.ok(gateway.getX402Middleware, 'Should have getX402Middleware');
    assert.ok(gateway.getJobManager, 'Should have getJobManager');
    assert.ok(gateway.getPromptHandler, 'Should have getPromptHandler');
    assert.ok(gateway.getCustodyManager, 'Should have getCustodyManager');
  });
});

// =============================================================================
// METRICS TESTS
// =============================================================================

describe('Gateway Metrics', () => {
  const { createApiGateway } = require('../../../src/api/gateway');

  it('should return metrics structure', () => {
    const gateway = createApiGateway();
    const metrics = gateway.getMetrics();

    assert.ok('totalRequests' in metrics);
    assert.ok('successfulRequests' in metrics);
    assert.ok('failedRequests' in metrics);
    assert.ok('totalRevenue' in metrics);
    assert.ok('revenueByTier' in metrics);
    assert.ok('avgResponseTime' in metrics);
    assert.ok('activeJobs' in metrics);
    assert.ok('uniqueWallets' in metrics);
    assert.ok('uptime' in metrics);
  });

  it('should initialize with zero counts', () => {
    const gateway = createApiGateway();
    const metrics = gateway.getMetrics();

    assert.strictEqual(metrics.totalRequests, 0);
    assert.strictEqual(metrics.successfulRequests, 0);
    assert.strictEqual(metrics.failedRequests, 0);
    assert.strictEqual(metrics.totalRevenue, 0);
  });

  it('should track uptime', async () => {
    const gateway = createApiGateway();

    // Small delay
    await new Promise((r) => setTimeout(r, 50));

    const metrics = gateway.getMetrics();
    assert.ok(metrics.uptime >= 0);
  });

  it('should have revenue breakdown by tier', () => {
    const gateway = createApiGateway();
    const metrics = gateway.getMetrics();

    assert.ok('basic' in metrics.revenueByTier);
    assert.ok('standard' in metrics.revenueByTier);
    assert.ok('complex' in metrics.revenueByTier);
  });
});

// =============================================================================
// HTTP SERVER TESTS
// =============================================================================

describe('HTTP Server', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    // Use random port for tests
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
    }
  });

  it('should start and stop server', async () => {
    await gateway.start();

    // Server should be running
    const response = await makeRequest(testPort, 'GET', '/health');
    assert.strictEqual(response.status, 200);

    await gateway.stop();

    // Server should be stopped (connection refused)
    try {
      await makeRequest(testPort, 'GET', '/health');
      assert.fail('Should have thrown');
    } catch {
      // Expected
    }
  });

  it('should return 404 for unknown routes', async () => {
    await gateway.start();

    const response = await makeRequest(testPort, 'GET', '/unknown/path');

    assert.strictEqual(response.status, 404);
    assert.deepStrictEqual(response.body, { error: 'Not found' });
  });

  it('should handle CORS preflight', async () => {
    await gateway.start();

    const response = await makeRequest(testPort, 'OPTIONS', '/v2/prompt');

    assert.strictEqual(response.status, 204);
    assert.ok(response.headers['access-control-allow-methods']);
  });
});

// =============================================================================
// HEALTH ENDPOINT TESTS
// =============================================================================

describe('Health Endpoint', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should return healthy status', async () => {
    const response = await makeRequest(testPort, 'GET', '/health');

    assert.strictEqual(response.status, 200);
    assert.strictEqual((response.body as any).status, 'healthy');
  });

  it('should include timestamp', async () => {
    const before = Date.now();
    const response = await makeRequest(testPort, 'GET', '/health');
    const after = Date.now();

    const timestamp = (response.body as any).timestamp;
    assert.ok(timestamp >= before);
    assert.ok(timestamp <= after);
  });

  it('should include uptime', async () => {
    const response = await makeRequest(testPort, 'GET', '/health');

    assert.ok('uptime' in (response.body as any));
    assert.ok((response.body as any).uptime >= 0);
  });
});

// =============================================================================
// METRICS ENDPOINT TESTS
// =============================================================================

describe('Metrics Endpoint', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should return metrics without auth when no token set', async () => {
    const originalToken = process.env.CLODDS_TOKEN;
    delete process.env.CLODDS_TOKEN;

    try {
      const response = await makeRequest(testPort, 'GET', '/metrics');

      assert.strictEqual(response.status, 200);
      assert.ok('totalRequests' in (response.body as any));
    } finally {
      if (originalToken) {
        process.env.CLODDS_TOKEN = originalToken;
      }
    }
  });

  it('should require auth when token is set', async () => {
    const originalToken = process.env.CLODDS_TOKEN;
    process.env.CLODDS_TOKEN = 'test-secret-token';

    try {
      const response = await makeRequest(testPort, 'GET', '/metrics');

      assert.strictEqual(response.status, 401);
    } finally {
      if (originalToken) {
        process.env.CLODDS_TOKEN = originalToken;
      } else {
        delete process.env.CLODDS_TOKEN;
      }
    }
  });

  it('should accept valid token via header', async () => {
    const originalToken = process.env.CLODDS_TOKEN;
    process.env.CLODDS_TOKEN = 'test-secret-token';

    try {
      const response = await makeRequest(testPort, 'GET', '/metrics', {
        headers: { Authorization: 'Bearer test-secret-token' },
      });

      assert.strictEqual(response.status, 200);
    } finally {
      if (originalToken) {
        process.env.CLODDS_TOKEN = originalToken;
      } else {
        delete process.env.CLODDS_TOKEN;
      }
    }
  });

  it('should accept valid token via query param', async () => {
    const originalToken = process.env.CLODDS_TOKEN;
    process.env.CLODDS_TOKEN = 'test-secret-token';

    try {
      const response = await makeRequest(testPort, 'GET', '/metrics?token=test-secret-token');

      assert.strictEqual(response.status, 200);
    } finally {
      if (originalToken) {
        process.env.CLODDS_TOKEN = originalToken;
      } else {
        delete process.env.CLODDS_TOKEN;
      }
    }
  });
});

// =============================================================================
// RATE LIMITING TESTS
// =============================================================================

describe('Rate Limiting', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({
      port: testPort,
      rateLimit: { perMinute: 5, perWallet: 10, burst: 2 },
    });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should allow requests within limit', async () => {
    // Make a few requests
    for (let i = 0; i < 3; i++) {
      const response = await makeRequest(testPort, 'GET', '/health');
      assert.strictEqual(response.status, 200);
    }
  });
});

// =============================================================================
// PROMPT ENDPOINT TESTS
// =============================================================================

describe('Prompt Endpoint', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should require wallet address', async () => {
    const response = await makeRequest(testPort, 'POST', '/v2/prompt', {
      body: { prompt: 'What is the price of BTC?' },
    });

    assert.strictEqual(response.status, 400);
    assert.ok((response.body as any).error.includes('wallet'));
  });

  it('should require prompt', async () => {
    const response = await makeRequest(testPort, 'POST', '/v2/prompt', {
      body: { wallet: '0x1234' },
    });

    assert.strictEqual(response.status, 400);
    assert.ok((response.body as any).error.includes('prompt'));
  });

  it('should return 402 when payment required', async () => {
    const response = await makeRequest(testPort, 'POST', '/v2/prompt', {
      body: {
        prompt: 'What is the price of BTC?',
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
      },
    });

    // Should require payment (no payment proof provided)
    assert.strictEqual(response.status, 402);
    assert.ok((response.body as any).error.includes('Payment'));
    assert.ok((response.body as any).amount > 0);
    assert.ok((response.body as any).paymentAddress);
  });

  it('should include x402 protocol info in 402 response', async () => {
    const response = await makeRequest(testPort, 'POST', '/v2/prompt', {
      body: {
        prompt: 'Execute trade',
        wallet: '0x1234567890abcdef1234567890abcdef12345678',
      },
    });

    assert.strictEqual(response.status, 402);
    assert.strictEqual((response.body as any).protocol, 'x402');
    assert.ok((response.body as any).tier);
    assert.ok((response.body as any).currency);
  });
});

// =============================================================================
// JOB ENDPOINTS TESTS
// =============================================================================

describe('Job Endpoints', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should return 404 for non-existent job', async () => {
    const response = await makeRequest(testPort, 'GET', '/v2/job/non-existent-job');

    assert.strictEqual(response.status, 404);
  });

  it('should require wallet for job list', async () => {
    const response = await makeRequest(testPort, 'GET', '/v2/jobs');

    assert.strictEqual(response.status, 400);
    assert.ok((response.body as any).error.includes('wallet'));
  });

  it('should return empty jobs list for new wallet', async () => {
    const response = await makeRequest(testPort, 'GET', '/v2/jobs?wallet=0x1234');

    assert.strictEqual(response.status, 200);
    assert.ok(Array.isArray((response.body as any).jobs));
    assert.strictEqual((response.body as any).jobs.length, 0);
  });

  it('should accept wallet via header', async () => {
    const response = await makeRequest(testPort, 'GET', '/v2/jobs', {
      headers: { 'x-wallet-address': '0x1234' },
    });

    assert.strictEqual(response.status, 200);
  });
});

// =============================================================================
// WALLET ENDPOINT TESTS
// =============================================================================

describe('Wallet Endpoint', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    // Custody disabled by default
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should return error when custody disabled', async () => {
    const response = await makeRequest(testPort, 'GET', '/v2/wallet', {
      headers: { 'x-wallet-address': '0x1234' },
    });

    assert.strictEqual(response.status, 400);
    assert.ok((response.body as any).error.includes('not enabled'));
  });
});

// =============================================================================
// CORS TESTS
// =============================================================================

describe('CORS Handling', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  afterEach(async () => {
    if (gateway) {
      await gateway.stop();
    }
  });

  it('should include CORS headers when enabled', async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort, cors: true });
    await gateway.start();

    const response = await makeRequest(testPort, 'GET', '/health');

    assert.ok(response.headers['access-control-allow-origin']);
  });

  it('should set allow-origin to * by default', async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort, cors: true });
    await gateway.start();

    const response = await makeRequest(testPort, 'GET', '/health');

    assert.strictEqual(response.headers['access-control-allow-origin'], '*');
  });
});

// =============================================================================
// RESPONSE HEADERS TESTS
// =============================================================================

describe('Response Headers', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should include X-Powered-By header', async () => {
    const response = await makeRequest(testPort, 'GET', '/health');

    assert.strictEqual(response.headers['x-powered-by'], 'Clodds');
  });

  it('should include X-Clodds-Version header', async () => {
    const response = await makeRequest(testPort, 'GET', '/health');

    assert.ok(response.headers['x-clodds-version']);
  });

  it('should include X-Request-Id header', async () => {
    const response = await makeRequest(testPort, 'GET', '/health');

    assert.ok(response.headers['x-request-id']);
    assert.strictEqual(response.headers['x-request-id'].length, 16); // 8 bytes hex
  });

  it('should generate unique request IDs', async () => {
    const response1 = await makeRequest(testPort, 'GET', '/health');
    const response2 = await makeRequest(testPort, 'GET', '/health');

    assert.notStrictEqual(
      response1.headers['x-request-id'],
      response2.headers['x-request-id']
    );
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  const { createApiGateway } = require('../../../src/api/gateway');
  let gateway: any;
  let testPort: number;

  beforeEach(async () => {
    testPort = 10000 + Math.floor(Math.random() * 50000);
    gateway = createApiGateway({ port: testPort });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
  });

  it('should return JSON error for invalid JSON body', async () => {
    // Send malformed JSON
    const response = await new Promise<TestResponse>((resolve, reject) => {
      const req = http.request(
        {
          hostname: 'localhost',
          port: testPort,
          path: '/v2/prompt',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode || 500,
              headers: {},
              body: data ? JSON.parse(data) : {},
            });
          });
        }
      );
      req.on('error', reject);
      req.write('{invalid json');
      req.end();
    });

    // Should still return JSON error (body parsing falls back to {})
    assert.strictEqual(response.status, 400);
  });

  it('should return 404 for partial route matches', async () => {
    const response = await makeRequest(testPort, 'GET', '/v2');
    assert.strictEqual(response.status, 404);
  });
});

console.log('Gateway tests loaded. Run with: npm test');
