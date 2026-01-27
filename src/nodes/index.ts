/**
 * Node Host - Clawdbot-style device node control
 *
 * Features:
 * - Camera snap/clip (macOS: imagesnap, Linux: fswebcam)
 * - Screen recording (macOS: screencapture, Linux: ffmpeg)
 * - Location access (macOS: CoreLocation via swift, Linux: geoclue)
 * - System notifications (macOS: osascript, Linux: notify-send)
 * - System commands (macOS: osascript AppleScript)
 */

import { execSync, exec, spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { logger } from '../utils/logger';

const TEMP_DIR = join(homedir(), '.clodds', 'temp');
const os = platform();

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
  mkdirSync(TEMP_DIR, { recursive: true });
}

// =============================================================================
// CAMERA
// =============================================================================

export interface CameraCapture {
  /** Take a single photo */
  snap(): Promise<Buffer>;
  /** Record video clip */
  startClip(durationMs: number): Promise<Buffer>;
  /** List available cameras */
  listDevices(): Promise<string[]>;
  /** Check if camera is available */
  isAvailable(): boolean;
}

function createCameraCapture(): CameraCapture {
  // Check for camera tools
  const hasImagesnap = os === 'darwin' && commandExists('imagesnap');
  const hasFfmpeg = commandExists('ffmpeg');
  const hasFswebcam = os === 'linux' && commandExists('fswebcam');

  return {
    async snap() {
      const outPath = join(TEMP_DIR, `camera_${Date.now()}.jpg`);

      try {
        if (os === 'darwin') {
          if (hasImagesnap) {
            // macOS with imagesnap
            execSync(`imagesnap -q "${outPath}"`, { timeout: 10000 });
          } else if (hasFfmpeg) {
            // Fallback to ffmpeg on macOS
            execSync(`ffmpeg -f avfoundation -framerate 30 -i "0" -frames:v 1 -y "${outPath}" 2>/dev/null`, { timeout: 10000 });
          } else {
            throw new Error('No camera tool available. Install imagesnap: brew install imagesnap');
          }
        } else if (os === 'linux') {
          if (hasFswebcam) {
            execSync(`fswebcam -q --no-banner "${outPath}"`, { timeout: 10000 });
          } else if (hasFfmpeg) {
            execSync(`ffmpeg -f v4l2 -i /dev/video0 -frames:v 1 -y "${outPath}" 2>/dev/null`, { timeout: 10000 });
          } else {
            throw new Error('No camera tool available. Install fswebcam: apt install fswebcam');
          }
        } else {
          throw new Error(`Camera not supported on ${os}`);
        }

        const buffer = readFileSync(outPath);
        unlinkSync(outPath);
        logger.debug('Camera snap captured');
        return buffer;
      } catch (error) {
        try { unlinkSync(outPath); } catch {}
        throw error;
      }
    },

    async startClip(durationMs) {
      const durationSec = Math.ceil(durationMs / 1000);
      const outPath = join(TEMP_DIR, `clip_${Date.now()}.mp4`);

      try {
        if (os === 'darwin' && hasFfmpeg) {
          execSync(`ffmpeg -f avfoundation -framerate 30 -i "0" -t ${durationSec} -y "${outPath}" 2>/dev/null`, {
            timeout: (durationSec + 5) * 1000,
          });
        } else if (os === 'linux' && hasFfmpeg) {
          execSync(`ffmpeg -f v4l2 -i /dev/video0 -t ${durationSec} -y "${outPath}" 2>/dev/null`, {
            timeout: (durationSec + 5) * 1000,
          });
        } else {
          throw new Error('Video recording requires ffmpeg');
        }

        const buffer = readFileSync(outPath);
        unlinkSync(outPath);
        logger.debug({ durationSec }, 'Camera clip recorded');
        return buffer;
      } catch (error) {
        try { unlinkSync(outPath); } catch {}
        throw error;
      }
    },

    async listDevices() {
      try {
        if (os === 'darwin') {
          const output = execSync('system_profiler SPCameraDataType 2>/dev/null', { encoding: 'utf-8' });
          const matches = output.match(/^\s+(.+):$/gm) || [];
          return matches.map(m => m.trim().replace(/:$/, ''));
        } else if (os === 'linux') {
          const output = execSync('v4l2-ctl --list-devices 2>/dev/null || ls /dev/video* 2>/dev/null', { encoding: 'utf-8' });
          return output.trim().split('\n').filter(Boolean);
        }
      } catch {}
      return [];
    },

    isAvailable() {
      return hasImagesnap || hasFswebcam || hasFfmpeg;
    },
  };
}

// =============================================================================
// SCREEN CAPTURE
// =============================================================================

export interface ScreenCapture {
  /** Take screenshot */
  screenshot(options?: { display?: number; window?: boolean }): Promise<Buffer>;
  /** Record screen */
  startRecording(durationMs: number, options?: { display?: number }): Promise<Buffer>;
  /** List displays */
  listDisplays(): Promise<Array<{ id: number; name: string; width: number; height: number }>>;
  /** Check if available */
  isAvailable(): boolean;
}

function createScreenCapture(): ScreenCapture {
  const hasScreencapture = os === 'darwin';
  const hasFfmpeg = commandExists('ffmpeg');
  const hasScrot = os === 'linux' && commandExists('scrot');
  const hasGnomeScreenshot = os === 'linux' && commandExists('gnome-screenshot');

  return {
    async screenshot(options = {}) {
      const outPath = join(TEMP_DIR, `screenshot_${Date.now()}.png`);

      try {
        if (os === 'darwin') {
          // macOS screencapture
          let cmd = 'screencapture -x';
          if (options.display !== undefined) cmd += ` -D${options.display}`;
          if (options.window) cmd += ' -w';
          cmd += ` "${outPath}"`;
          execSync(cmd, { timeout: 10000 });
        } else if (os === 'linux') {
          if (hasScrot) {
            execSync(`scrot "${outPath}"`, { timeout: 10000 });
          } else if (hasGnomeScreenshot) {
            execSync(`gnome-screenshot -f "${outPath}"`, { timeout: 10000 });
          } else if (hasFfmpeg) {
            execSync(`ffmpeg -f x11grab -framerate 1 -i :0 -frames:v 1 -y "${outPath}" 2>/dev/null`, { timeout: 10000 });
          } else {
            throw new Error('No screenshot tool. Install scrot: apt install scrot');
          }
        } else {
          throw new Error(`Screenshot not supported on ${os}`);
        }

        const buffer = readFileSync(outPath);
        unlinkSync(outPath);
        logger.debug('Screenshot captured');
        return buffer;
      } catch (error) {
        try { unlinkSync(outPath); } catch {}
        throw error;
      }
    },

    async startRecording(durationMs, options = {}) {
      const durationSec = Math.ceil(durationMs / 1000);
      const outPath = join(TEMP_DIR, `recording_${Date.now()}.mp4`);

      try {
        if (os === 'darwin') {
          // macOS screen recording with ffmpeg
          let display = options.display ?? 1;
          execSync(`ffmpeg -f avfoundation -framerate 30 -i "${display}:none" -t ${durationSec} -y "${outPath}" 2>/dev/null`, {
            timeout: (durationSec + 10) * 1000,
          });
        } else if (os === 'linux' && hasFfmpeg) {
          execSync(`ffmpeg -f x11grab -framerate 30 -i :0 -t ${durationSec} -y "${outPath}" 2>/dev/null`, {
            timeout: (durationSec + 10) * 1000,
          });
        } else {
          throw new Error('Screen recording requires ffmpeg');
        }

        const buffer = readFileSync(outPath);
        unlinkSync(outPath);
        logger.debug({ durationSec }, 'Screen recording captured');
        return buffer;
      } catch (error) {
        try { unlinkSync(outPath); } catch {}
        throw error;
      }
    },

    async listDisplays() {
      try {
        if (os === 'darwin') {
          const output = execSync('system_profiler SPDisplaysDataType -json 2>/dev/null', { encoding: 'utf-8' });
          const data = JSON.parse(output);
          const displays = data.SPDisplaysDataType?.[0]?.spdisplays_ndrvs || [];
          return displays.map((d: { _name: string; _spdisplays_resolution?: string }, i: number) => ({
            id: i + 1,
            name: d._name || `Display ${i + 1}`,
            width: parseInt(d._spdisplays_resolution?.split(' x ')?.[0] || '0'),
            height: parseInt(d._spdisplays_resolution?.split(' x ')?.[1] || '0'),
          }));
        } else if (os === 'linux') {
          const output = execSync('xrandr --query 2>/dev/null', { encoding: 'utf-8' });
          const matches = output.match(/(\S+) connected.*?(\d+)x(\d+)/g) || [];
          return matches.map((m, i) => {
            const parts = m.match(/(\S+) connected.*?(\d+)x(\d+)/);
            return {
              id: i,
              name: parts?.[1] || `Display ${i}`,
              width: parseInt(parts?.[2] || '0'),
              height: parseInt(parts?.[3] || '0'),
            };
          });
        }
      } catch {}
      return [];
    },

    isAvailable() {
      return hasScreencapture || hasScrot || hasGnomeScreenshot || hasFfmpeg;
    },
  };
}

// =============================================================================
// LOCATION
// =============================================================================

export interface LocationService {
  /** Get current location */
  get(): Promise<{ lat: number; lon: number; accuracy: number } | null>;
  /** Check if available */
  isAvailable(): boolean;
}

function createLocationService(): LocationService {
  return {
    async get() {
      try {
        if (os === 'darwin') {
          // macOS: Use CoreLocation via swift
          const swiftCode = `
import CoreLocation
import Foundation

class LocationDelegate: NSObject, CLLocationManagerDelegate {
    var semaphore = DispatchSemaphore(value: 0)
    var location: CLLocation?

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        location = locations.last
        semaphore.signal()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        semaphore.signal()
    }
}

let delegate = LocationDelegate()
let manager = CLLocationManager()
manager.delegate = delegate
manager.desiredAccuracy = kCLLocationAccuracyBest
manager.requestWhenInUseAuthorization()
manager.startUpdatingLocation()

_ = delegate.semaphore.wait(timeout: .now() + 5)
manager.stopUpdatingLocation()

if let loc = delegate.location {
    print("\\(loc.coordinate.latitude),\\(loc.coordinate.longitude),\\(loc.horizontalAccuracy)")
} else {
    print("ERROR")
}
`;
          const scriptPath = join(TEMP_DIR, 'location.swift');
          writeFileSync(scriptPath, swiftCode);

          try {
            const output = execSync(`swift "${scriptPath}" 2>/dev/null`, { encoding: 'utf-8', timeout: 10000 });
            unlinkSync(scriptPath);

            if (output.trim() === 'ERROR') return null;

            const [lat, lon, accuracy] = output.trim().split(',').map(Number);
            logger.debug({ lat, lon, accuracy }, 'Location retrieved');
            return { lat, lon, accuracy };
          } catch {
            try { unlinkSync(scriptPath); } catch {}
            return null;
          }
        } else if (os === 'linux') {
          // Linux: Try geoclue via dbus
          try {
            const output = execSync('gdbus call --system --dest org.freedesktop.GeoClue2 --object-path /org/freedesktop/GeoClue2/Manager --method org.freedesktop.GeoClue2.Manager.GetClient 2>/dev/null', { encoding: 'utf-8' });
            // Parse geoclue response (complex, simplified here)
            return null; // Would need full geoclue integration
          } catch {
            return null;
          }
        }
      } catch {}
      return null;
    },

    isAvailable() {
      return os === 'darwin' || os === 'linux';
    },
  };
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

export interface NotificationService {
  /** Send notification */
  send(title: string, body: string, opts?: { sound?: boolean; subtitle?: string }): Promise<void>;
  /** Check if available */
  isAvailable(): boolean;
}

function createNotificationService(): NotificationService {
  const hasNotifySend = os === 'linux' && commandExists('notify-send');

  return {
    async send(title, body, opts = {}) {
      try {
        if (os === 'darwin') {
          // macOS: osascript
          let script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`;
          if (opts.subtitle) {
            script = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}" subtitle "${escapeAppleScript(opts.subtitle)}"`;
          }
          if (opts.sound) {
            script += ' sound name "default"';
          }
          execSync(`osascript -e '${script}'`, { timeout: 5000 });
        } else if (os === 'linux' && hasNotifySend) {
          execSync(`notify-send "${title}" "${body}"`, { timeout: 5000 });
        } else {
          throw new Error('Notifications not available');
        }

        logger.debug({ title }, 'Notification sent');
      } catch (error) {
        logger.error({ error, title }, 'Failed to send notification');
        throw error;
      }
    },

    isAvailable() {
      return os === 'darwin' || hasNotifySend;
    },
  };
}

// =============================================================================
// SYSTEM COMMANDS (macOS)
// =============================================================================

export interface SystemService {
  /** Run AppleScript (macOS only) */
  run(script: string): Promise<string>;
  /** Say text (text-to-speech) */
  say(text: string, voice?: string): Promise<void>;
  /** Open URL or file */
  open(target: string): Promise<void>;
  /** Get clipboard contents */
  getClipboard(): Promise<string>;
  /** Set clipboard contents */
  setClipboard(text: string): Promise<void>;
  /** Check if available */
  isAvailable(): boolean;
}

function createSystemService(): SystemService {
  return {
    async run(script) {
      if (os !== 'darwin') {
        throw new Error('AppleScript only available on macOS');
      }

      const output = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf-8',
        timeout: 30000,
      });

      logger.debug({ script: script.slice(0, 50) }, 'AppleScript executed');
      return output.trim();
    },

    async say(text, voice) {
      if (os === 'darwin') {
        const voiceArg = voice ? `-v "${voice}"` : '';
        execSync(`say ${voiceArg} "${text.replace(/"/g, '\\"')}"`, { timeout: 60000 });
      } else if (os === 'linux' && commandExists('espeak')) {
        execSync(`espeak "${text.replace(/"/g, '\\"')}"`, { timeout: 60000 });
      } else {
        throw new Error('Text-to-speech not available');
      }
      logger.debug({ text: text.slice(0, 50) }, 'Text spoken');
    },

    async open(target) {
      if (os === 'darwin') {
        execSync(`open "${target}"`, { timeout: 5000 });
      } else if (os === 'linux') {
        execSync(`xdg-open "${target}"`, { timeout: 5000 });
      } else {
        throw new Error('Open not available');
      }
      logger.debug({ target }, 'Opened target');
    },

    async getClipboard() {
      if (os === 'darwin') {
        return execSync('pbpaste', { encoding: 'utf-8', timeout: 5000 });
      } else if (os === 'linux' && commandExists('xclip')) {
        return execSync('xclip -selection clipboard -o', { encoding: 'utf-8', timeout: 5000 });
      }
      throw new Error('Clipboard not available');
    },

    async setClipboard(text) {
      if (os === 'darwin') {
        execSync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`, { timeout: 5000 });
      } else if (os === 'linux' && commandExists('xclip')) {
        execSync(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard`, { timeout: 5000 });
      } else {
        throw new Error('Clipboard not available');
      }
      logger.debug('Clipboard set');
    },

    isAvailable() {
      return os === 'darwin' || os === 'linux';
    },
  };
}

// =============================================================================
// NODE HOST
// =============================================================================

export interface NodeHost {
  camera: CameraCapture;
  screen: ScreenCapture;
  location: LocationService;
  notifications: NotificationService;
  system: SystemService;
}

export function createNodeHost(): NodeHost {
  return {
    camera: createCameraCapture(),
    screen: createScreenCapture(),
    location: createLocationService(),
    notifications: createNotificationService(),
    system: createSystemService(),
  };
}

// =============================================================================
// HELPERS
// =============================================================================

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
