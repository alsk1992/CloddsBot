/**
 * Nodes Tool - Device node control (camera, screen, notifications)
 *
 * Features:
 * - Discover paired device nodes (macOS, iOS, Android)
 * - Camera capture (snap photos, record video)
 * - Screen recording
 * - Location access
 * - System notifications
 * - System commands (macOS only)
 */

import { logger } from '../utils/logger';
import type { WebSocket } from 'ws';

/** Node types */
export type NodeType = 'macos' | 'ios' | 'android' | 'web';

/** Node capabilities */
export type NodeCapability =
  | 'camera.snap'
  | 'camera.record'
  | 'screen.record'
  | 'location.get'
  | 'notification.send'
  | 'system.run'
  | 'system.notify'
  | 'canvas';

/** Connected node */
export interface DeviceNode {
  id: string;
  name: string;
  type: NodeType;
  capabilities: NodeCapability[];
  /** OS version */
  osVersion?: string;
  /** Device model */
  model?: string;
  /** Connection state */
  connected: boolean;
  connectedAt: Date;
  lastSeen: Date;
}

/** Camera snap result */
export interface CameraSnapResult {
  /** Base64 image data */
  image: string;
  /** Image format */
  format: 'jpeg' | 'png';
  /** Dimensions */
  width: number;
  height: number;
  timestamp: Date;
}

/** Screen recording result */
export interface ScreenRecordResult {
  /** Base64 video data or file path */
  video: string;
  /** Duration in seconds */
  duration: number;
  /** Dimensions */
  width: number;
  height: number;
  timestamp: Date;
}

/** Location result */
export interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
  timestamp: Date;
}

/** System run result */
export interface SystemRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Node info from registration */
interface NodeRegistration {
  id: string;
  name: string;
  type: NodeType;
  capabilities: NodeCapability[];
  osVersion?: string;
  model?: string;
  ws: WebSocket;
}

export interface NodesTool {
  /** List all connected nodes */
  list(): DeviceNode[];

  /** Get node by ID */
  get(nodeId: string): DeviceNode | undefined;

  /** Describe node capabilities */
  describe(nodeId: string): { capabilities: NodeCapability[]; permissions: Record<string, boolean> } | null;

  /** Take camera snapshot */
  cameraSnap(nodeId: string, options?: {
    camera?: 'front' | 'back';
    quality?: number;
  }): Promise<CameraSnapResult>;

  /** Record camera video */
  cameraRecord(nodeId: string, options?: {
    camera?: 'front' | 'back';
    duration?: number;
    quality?: number;
  }): Promise<ScreenRecordResult>;

  /** Record screen */
  screenRecord(nodeId: string, options?: {
    duration?: number;
    quality?: number;
  }): Promise<ScreenRecordResult>;

  /** Get device location */
  locationGet(nodeId: string): Promise<LocationResult>;

  /** Send notification to device */
  notificationSend(nodeId: string, options: {
    title: string;
    body: string;
    sound?: boolean;
  }): Promise<void>;

  /** Run system command (macOS only) */
  systemRun(nodeId: string, command: string, options?: {
    needsScreenRecording?: boolean;
    timeout?: number;
  }): Promise<SystemRunResult>;

  /** Show system notification (macOS only) */
  systemNotify(nodeId: string, options: {
    title: string;
    subtitle?: string;
    body: string;
    sound?: string;
  }): Promise<void>;

  /** Invoke arbitrary action on node */
  invoke<T = unknown>(nodeId: string, action: string, params?: Record<string, unknown>): Promise<T>;

  /** Register a node */
  registerNode(registration: NodeRegistration): void;

  /** Unregister a node */
  unregisterNode(nodeId: string): void;
}

export function createNodesTool(): NodesTool {
  const nodes = new Map<string, DeviceNode & { ws: WebSocket }>();
  const pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  /** Generate request ID */
  function generateRequestId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /** Send request to node and wait for response */
  async function sendRequest<T>(
    nodeId: string,
    action: string,
    params: Record<string, unknown> = {},
    timeout = 30000
  ): Promise<T> {
    const node = nodes.get(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    if (!node.connected || node.ws.readyState !== 1) {
      throw new Error(`Node not connected: ${nodeId}`);
    }

    const requestId = generateRequestId();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${action}`));
      }, timeout);

      pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timeout: timer });

      node.ws.send(JSON.stringify({
        type: 'node.invoke',
        requestId,
        action,
        params,
      }));
    });
  }

  /** Handle response from node */
  function handleResponse(data: { requestId: string; result?: unknown; error?: string }): void {
    const pending = pendingRequests.get(data.requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    pendingRequests.delete(data.requestId);

    if (data.error) {
      pending.reject(new Error(data.error));
    } else {
      pending.resolve(data.result);
    }
  }

  const tool: NodesTool = {
    list() {
      return Array.from(nodes.values()).map(({ ws, ...node }) => node);
    },

    get(nodeId) {
      const node = nodes.get(nodeId);
      if (!node) return undefined;
      const { ws, ...rest } = node;
      return rest;
    },

    describe(nodeId) {
      const node = nodes.get(nodeId);
      if (!node) return null;

      // Build permissions map based on capabilities
      const permissions: Record<string, boolean> = {};
      for (const cap of node.capabilities) {
        permissions[cap] = true;
      }

      return {
        capabilities: node.capabilities,
        permissions,
      };
    },

    async cameraSnap(nodeId, options = {}) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('camera.snap')) {
        throw new Error('Node does not support camera.snap');
      }

      const result = await sendRequest<{
        image: string;
        format: 'jpeg' | 'png';
        width: number;
        height: number;
      }>(nodeId, 'camera.snap', {
        camera: options.camera || 'back',
        quality: options.quality || 80,
      });

      return {
        ...result,
        timestamp: new Date(),
      };
    },

    async cameraRecord(nodeId, options = {}) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('camera.record')) {
        throw new Error('Node does not support camera.record');
      }

      const duration = options.duration || 5;
      const timeout = (duration + 10) * 1000;

      const result = await sendRequest<{
        video: string;
        duration: number;
        width: number;
        height: number;
      }>(nodeId, 'camera.record', {
        camera: options.camera || 'back',
        duration,
        quality: options.quality || 720,
      }, timeout);

      return {
        ...result,
        timestamp: new Date(),
      };
    },

    async screenRecord(nodeId, options = {}) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('screen.record')) {
        throw new Error('Node does not support screen.record');
      }

      const duration = options.duration || 5;
      const timeout = (duration + 10) * 1000;

      const result = await sendRequest<{
        video: string;
        duration: number;
        width: number;
        height: number;
      }>(nodeId, 'screen.record', {
        duration,
        quality: options.quality || 720,
      }, timeout);

      return {
        ...result,
        timestamp: new Date(),
      };
    },

    async locationGet(nodeId) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('location.get')) {
        throw new Error('Node does not support location.get');
      }

      const result = await sendRequest<{
        latitude: number;
        longitude: number;
        accuracy: number;
        altitude?: number;
      }>(nodeId, 'location.get', {});

      return {
        ...result,
        timestamp: new Date(),
      };
    },

    async notificationSend(nodeId, options) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('notification.send')) {
        throw new Error('Node does not support notification.send');
      }

      await sendRequest(nodeId, 'notification.send', {
        title: options.title,
        body: options.body,
        sound: options.sound ?? true,
      });
    },

    async systemRun(nodeId, command, options = {}) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('system.run')) {
        throw new Error('Node does not support system.run');
      }

      if (node.type !== 'macos') {
        throw new Error('system.run is only available on macOS nodes');
      }

      return sendRequest<SystemRunResult>(nodeId, 'system.run', {
        command,
        needsScreenRecording: options.needsScreenRecording || false,
      }, options.timeout || 60000);
    },

    async systemNotify(nodeId, options) {
      const node = nodes.get(nodeId);
      if (!node?.capabilities.includes('system.notify')) {
        throw new Error('Node does not support system.notify');
      }

      await sendRequest(nodeId, 'system.notify', options);
    },

    async invoke<T>(nodeId: string, action: string, params: Record<string, unknown> = {}) {
      return sendRequest<T>(nodeId, action, params);
    },

    registerNode(registration) {
      const { ws, ...info } = registration;

      const node: DeviceNode & { ws: WebSocket } = {
        ...info,
        ws,
        connected: true,
        connectedAt: new Date(),
        lastSeen: new Date(),
      };

      nodes.set(info.id, node);

      // Handle messages from node
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.requestId) {
            handleResponse(msg);
          }
          node.lastSeen = new Date();
        } catch {
          // Ignore parse errors
        }
      });

      ws.on('close', () => {
        const n = nodes.get(info.id);
        if (n) {
          n.connected = false;
        }
        logger.info({ nodeId: info.id }, 'Device node disconnected');
      });

      ws.on('error', (err) => {
        logger.error({ err, nodeId: info.id }, 'Device node error');
      });

      logger.info(
        { nodeId: info.id, type: info.type, capabilities: info.capabilities },
        'Device node registered'
      );
    },

    unregisterNode(nodeId) {
      const node = nodes.get(nodeId);
      if (node) {
        node.connected = false;
        nodes.delete(nodeId);
        logger.info({ nodeId }, 'Device node unregistered');
      }
    },
  };

  return tool;
}
