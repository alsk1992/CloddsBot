/**
 * Daemon Service - Clawdbot-style background service management
 *
 * Features:
 * - Install as launchd (macOS) or systemd (Linux) service
 * - Start/stop/restart
 * - Status checking
 * - Log management
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

const SERVICE_NAME = 'com.clodds.gateway';

function getLaunchdPlist() {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_NAME}.plist`);
}

function getSystemdService() {
  return join(homedir(), '.config', 'systemd', 'user', 'clodds.service');
}

function getLogPath() {
  return join(homedir(), '.clodds', 'gateway.log');
}

export interface DaemonService {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  status(): Promise<{ installed: boolean; running: boolean; pid?: number }>;
  logs(lines?: number): Promise<string>;
}

export function createDaemonService(): DaemonService {
  const os = platform();

  return {
    async install() {
      if (os === 'darwin') {
        const logPath = getLogPath();
        const errorLogPath = logPath.replace('.log', '.error.log');
        const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npx</string>
    <string>clodds</string>
    <string>gateway</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${errorLogPath}</string>
</dict>
</plist>`;
        const plistPath = getLaunchdPlist();
        writeFileSync(plistPath, plist);
        execSync(`launchctl load ${plistPath}`);
        logger.info('Daemon installed (launchd)');
      } else if (os === 'linux') {
        const service = `[Unit]
Description=Clodds Gateway
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env npx clodds gateway
Restart=always
RestartSec=10

[Install]
WantedBy=default.target`;
        const servicePath = getSystemdService();
        writeFileSync(servicePath, service);
        execSync('systemctl --user daemon-reload');
        execSync('systemctl --user enable clodds');
        logger.info('Daemon installed (systemd)');
      } else {
        throw new Error(`Unsupported platform: ${os}`);
      }
    },

    async uninstall() {
      if (os === 'darwin') {
        const plistPath = getLaunchdPlist();
        if (existsSync(plistPath)) {
          execSync(`launchctl unload ${plistPath}`);
          unlinkSync(plistPath);
        }
        logger.info('Daemon uninstalled');
      } else if (os === 'linux') {
        const servicePath = getSystemdService();
        execSync('systemctl --user disable clodds');
        if (existsSync(servicePath)) {
          unlinkSync(servicePath);
        }
        execSync('systemctl --user daemon-reload');
        logger.info('Daemon uninstalled');
      }
    },

    async start() {
      if (os === 'darwin') {
        execSync(`launchctl start ${SERVICE_NAME}`);
      } else if (os === 'linux') {
        execSync('systemctl --user start clodds');
      }
      logger.info('Daemon started');
    },

    async stop() {
      if (os === 'darwin') {
        execSync(`launchctl stop ${SERVICE_NAME}`);
      } else if (os === 'linux') {
        execSync('systemctl --user stop clodds');
      }
      logger.info('Daemon stopped');
    },

    async restart() {
      await this.stop();
      await this.start();
    },

    async status() {
      const plistPath = getLaunchdPlist();
      const servicePath = getSystemdService();
      
      try {
        if (os === 'darwin') {
          const output = execSync(`launchctl list | grep ${SERVICE_NAME}`, { encoding: 'utf-8' });
          const parts = output.trim().split(/\s+/);
          const pid = parseInt(parts[0], 10);
          return { installed: true, running: !isNaN(pid) && pid > 0, pid: isNaN(pid) ? undefined : pid };
        } else if (os === 'linux') {
          const output = execSync('systemctl --user is-active clodds', { encoding: 'utf-8' });
          return { installed: true, running: output.trim() === 'active' };
        }
      } catch {
        return { installed: existsSync(plistPath) || existsSync(servicePath), running: false };
      }
      return { installed: false, running: false };
    },

    async logs(lines = 100) {
      const logPath = getLogPath();
      if (existsSync(logPath)) {
        const content = readFileSync(logPath, 'utf-8');
        return content.split('\n').slice(-lines).join('\n');
      }
      return '';
    },
  };
}
