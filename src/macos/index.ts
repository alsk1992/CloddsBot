/**
 * macOS Module - Clawdbot-style macOS integrations
 *
 * Features:
 * - AppleScript execution
 * - Notification Center
 * - Spotlight search
 * - Finder integration
 * - System preferences
 * - Keychain access
 * - Audio/Speech
 * - Application control
 */

import { exec, execSync, spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir, platform } from 'os';
import { promisify } from 'util';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface NotificationOptions {
  title: string;
  message: string;
  subtitle?: string;
  sound?: string | boolean;
  icon?: string;
}

export interface DialogOptions {
  message: string;
  title?: string;
  buttons?: string[];
  defaultButton?: number;
  icon?: 'note' | 'caution' | 'stop';
  defaultAnswer?: string;
  hiddenAnswer?: boolean;
}

export interface DialogResult {
  buttonReturned: string;
  textReturned?: string;
}

export interface FileDialogOptions {
  prompt?: string;
  defaultLocation?: string;
  fileTypes?: string[];
  multiple?: boolean;
}

export interface ApplicationInfo {
  name: string;
  path: string;
  bundleId: string;
  version?: string;
  running: boolean;
}

export interface SpotlightResult {
  path: string;
  name: string;
  kind?: string;
  modified?: Date;
}

// =============================================================================
// HELPERS
// =============================================================================

function isMacOS(): boolean {
  return platform() === 'darwin';
}

function assertMacOS(): void {
  if (!isMacOS()) {
    throw new Error('This function is only available on macOS');
  }
}

/** Execute AppleScript */
export async function runAppleScript(script: string): Promise<string> {
  assertMacOS();

  // Write script to temp file to handle multi-line scripts better
  const tempFile = join(tmpdir(), `clodds-applescript-${Date.now()}.scpt`);
  writeFileSync(tempFile, script);

  try {
    const { stdout } = await execAsync(`osascript ${tempFile}`);
    return stdout.trim();
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

/** Execute AppleScript synchronously */
export function runAppleScriptSync(script: string): string {
  assertMacOS();

  const tempFile = join(tmpdir(), `clodds-applescript-${Date.now()}.scpt`);
  writeFileSync(tempFile, script);

  try {
    return execSync(`osascript ${tempFile}`, { encoding: 'utf-8' }).trim();
  } finally {
    try { unlinkSync(tempFile); } catch {}
  }
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

/** Show a notification */
export async function notify(options: NotificationOptions): Promise<void> {
  assertMacOS();

  let script = `display notification "${escapeString(options.message)}"`;

  if (options.title) {
    script += ` with title "${escapeString(options.title)}"`;
  }

  if (options.subtitle) {
    script += ` subtitle "${escapeString(options.subtitle)}"`;
  }

  if (options.sound === true) {
    script += ` sound name "default"`;
  } else if (typeof options.sound === 'string') {
    script += ` sound name "${escapeString(options.sound)}"`;
  }

  await runAppleScript(script);
  logger.debug({ title: options.title }, 'Notification sent');
}

// =============================================================================
// DIALOGS
// =============================================================================

/** Show a dialog box */
export async function dialog(options: DialogOptions): Promise<DialogResult> {
  assertMacOS();

  let script = `display dialog "${escapeString(options.message)}"`;

  if (options.title) {
    script += ` with title "${escapeString(options.title)}"`;
  }

  if (options.buttons) {
    const buttons = options.buttons.map(b => `"${escapeString(b)}"`).join(', ');
    script += ` buttons {${buttons}}`;
  }

  if (options.defaultButton) {
    script += ` default button ${options.defaultButton}`;
  }

  if (options.icon) {
    script += ` with icon ${options.icon}`;
  }

  if (options.defaultAnswer !== undefined) {
    script += ` default answer "${escapeString(options.defaultAnswer)}"`;
  }

  if (options.hiddenAnswer) {
    script += ` with hidden answer`;
  }

  const result = await runAppleScript(script);

  // Parse result
  const buttonMatch = result.match(/button returned:(.+?)(?:,|$)/);
  const textMatch = result.match(/text returned:(.+?)(?:,|$)/);

  return {
    buttonReturned: buttonMatch ? buttonMatch[1].trim() : '',
    textReturned: textMatch ? textMatch[1].trim() : undefined,
  };
}

/** Show an alert */
export async function alert(message: string, title?: string): Promise<void> {
  await dialog({ message, title, buttons: ['OK'] });
}

/** Show a file open dialog */
export async function openFileDialog(options: FileDialogOptions = {}): Promise<string[]> {
  assertMacOS();

  let script = `choose file`;

  if (options.prompt) {
    script += ` with prompt "${escapeString(options.prompt)}"`;
  }

  if (options.defaultLocation) {
    script += ` default location POSIX file "${escapeString(options.defaultLocation)}"`;
  }

  if (options.fileTypes) {
    const types = options.fileTypes.map(t => `"${t}"`).join(', ');
    script += ` of type {${types}}`;
  }

  if (options.multiple) {
    script += ` with multiple selections allowed`;
  }

  try {
    const result = await runAppleScript(script);
    // Convert alias paths to POSIX paths
    const paths = result.split(', ').map(p => {
      const posix = runAppleScriptSync(`POSIX path of "${p.trim()}"`);
      return posix;
    });
    return paths;
  } catch {
    return []; // User cancelled
  }
}

/** Show a folder open dialog */
export async function openFolderDialog(options: FileDialogOptions = {}): Promise<string | null> {
  assertMacOS();

  let script = `choose folder`;

  if (options.prompt) {
    script += ` with prompt "${escapeString(options.prompt)}"`;
  }

  if (options.defaultLocation) {
    script += ` default location POSIX file "${escapeString(options.defaultLocation)}"`;
  }

  try {
    const result = await runAppleScript(script);
    return runAppleScriptSync(`POSIX path of "${result.trim()}"`);
  } catch {
    return null; // User cancelled
  }
}

/** Show a save file dialog */
export async function saveFileDialog(options: FileDialogOptions & { defaultName?: string } = {}): Promise<string | null> {
  assertMacOS();

  let script = `choose file name`;

  if (options.prompt) {
    script += ` with prompt "${escapeString(options.prompt)}"`;
  }

  if (options.defaultLocation) {
    script += ` default location POSIX file "${escapeString(options.defaultLocation)}"`;
  }

  if (options.defaultName) {
    script += ` default name "${escapeString(options.defaultName)}"`;
  }

  try {
    const result = await runAppleScript(script);
    return runAppleScriptSync(`POSIX path of "${result.trim()}"`);
  } catch {
    return null;
  }
}

// =============================================================================
// APPLICATIONS
// =============================================================================

/** Get list of running applications */
export async function getRunningApps(): Promise<string[]> {
  assertMacOS();

  const script = `
    tell application "System Events"
      set appNames to name of every process whose background only is false
      return appNames
    end tell
  `;

  const result = await runAppleScript(script);
  return result.split(', ').map(s => s.trim());
}

/** Check if an application is running */
export async function isAppRunning(appName: string): Promise<boolean> {
  assertMacOS();

  const script = `
    tell application "System Events"
      return (exists (some process whose name is "${escapeString(appName)}"))
    end tell
  `;

  const result = await runAppleScript(script);
  return result.toLowerCase() === 'true';
}

/** Launch an application */
export async function launchApp(appName: string): Promise<void> {
  assertMacOS();

  await runAppleScript(`tell application "${escapeString(appName)}" to activate`);
  logger.info({ app: appName }, 'Application launched');
}

/** Quit an application */
export async function quitApp(appName: string, force = false): Promise<void> {
  assertMacOS();

  if (force) {
    await runAppleScript(`
      tell application "System Events"
        set appProcess to first process whose name is "${escapeString(appName)}"
        do shell script "kill -9 " & (unix id of appProcess)
      end tell
    `);
  } else {
    await runAppleScript(`tell application "${escapeString(appName)}" to quit`);
  }
  logger.info({ app: appName, force }, 'Application quit');
}

/** Get frontmost application */
export async function getFrontmostApp(): Promise<string> {
  assertMacOS();

  const script = `
    tell application "System Events"
      return name of first application process whose frontmost is true
    end tell
  `;

  return runAppleScript(script);
}

/** Bring application to front */
export async function activateApp(appName: string): Promise<void> {
  assertMacOS();
  await runAppleScript(`tell application "${escapeString(appName)}" to activate`);
}

// =============================================================================
// FINDER
// =============================================================================

/** Open a file/folder in Finder */
export async function revealInFinder(path: string): Promise<void> {
  assertMacOS();
  await runAppleScript(`tell application "Finder" to reveal POSIX file "${escapeString(path)}"`);
  await runAppleScript(`tell application "Finder" to activate`);
}

/** Get selected Finder items */
export async function getFinderSelection(): Promise<string[]> {
  assertMacOS();

  const script = `
    tell application "Finder"
      set selectedItems to selection
      set paths to {}
      repeat with item_ in selectedItems
        set end of paths to POSIX path of (item_ as alias)
      end repeat
      return paths
    end tell
  `;

  const result = await runAppleScript(script);
  if (!result) return [];
  return result.split(', ').map(s => s.trim());
}

/** Get current Finder folder */
export async function getFinderFolder(): Promise<string> {
  assertMacOS();

  const script = `
    tell application "Finder"
      return POSIX path of (insertion location as alias)
    end tell
  `;

  return runAppleScript(script);
}

/** Open folder in Finder */
export async function openInFinder(path: string): Promise<void> {
  assertMacOS();
  await runAppleScript(`tell application "Finder" to open POSIX file "${escapeString(path)}"`);
}

/** Move file to trash */
export async function moveToTrash(path: string): Promise<void> {
  assertMacOS();
  await runAppleScript(`
    tell application "Finder"
      delete POSIX file "${escapeString(path)}"
    end tell
  `);
}

// =============================================================================
// SPOTLIGHT
// =============================================================================

/** Search with Spotlight */
export async function spotlight(query: string, limit = 20): Promise<SpotlightResult[]> {
  assertMacOS();

  const { stdout } = await execAsync(`mdfind -limit ${limit} "${query.replace(/"/g, '\\"')}"`);
  const paths = stdout.trim().split('\n').filter(Boolean);

  return paths.map(path => ({
    path,
    name: path.split('/').pop() || '',
  }));
}

/** Search for files by name */
export async function findByName(name: string, limit = 20): Promise<SpotlightResult[]> {
  return spotlight(`kMDItemDisplayName == "*${name}*"cd`, limit);
}

/** Search for files by type */
export async function findByType(type: string, limit = 20): Promise<SpotlightResult[]> {
  return spotlight(`kMDItemContentType == "${type}"`, limit);
}

// =============================================================================
// SYSTEM
// =============================================================================

/** Get system volume (0-100) */
export async function getVolume(): Promise<number> {
  assertMacOS();
  const result = await runAppleScript('output volume of (get volume settings)');
  return parseInt(result, 10);
}

/** Set system volume (0-100) */
export async function setVolume(level: number): Promise<void> {
  assertMacOS();
  await runAppleScript(`set volume output volume ${Math.max(0, Math.min(100, level))}`);
}

/** Mute/unmute system */
export async function setMuted(muted: boolean): Promise<void> {
  assertMacOS();
  await runAppleScript(`set volume ${muted ? 'with' : 'without'} output muted`);
}

/** Check if system is muted */
export async function isMuted(): Promise<boolean> {
  assertMacOS();
  const result = await runAppleScript('output muted of (get volume settings)');
  return result.toLowerCase() === 'true';
}

/** Get screen brightness (0-1) */
export async function getBrightness(): Promise<number> {
  assertMacOS();
  try {
    const { stdout } = await execAsync('brightness -l | grep brightness | head -1');
    const match = stdout.match(/brightness\s+([\d.]+)/);
    return match ? parseFloat(match[1]) : 1;
  } catch {
    return 1;
  }
}

/** Set screen brightness (0-1) */
export async function setBrightness(level: number): Promise<void> {
  assertMacOS();
  try {
    await execAsync(`brightness ${Math.max(0, Math.min(1, level))}`);
  } catch {
    // brightness command might not be installed
    logger.warn('brightness command not available');
  }
}

/** Get dark mode status */
export async function isDarkMode(): Promise<boolean> {
  assertMacOS();
  const result = await runAppleScript(`
    tell application "System Events"
      return dark mode of appearance preferences
    end tell
  `);
  return result.toLowerCase() === 'true';
}

/** Set dark mode */
export async function setDarkMode(enabled: boolean): Promise<void> {
  assertMacOS();
  await runAppleScript(`
    tell application "System Events"
      set dark mode of appearance preferences to ${enabled}
    end tell
  `);
}

/** Sleep display */
export async function sleepDisplay(): Promise<void> {
  assertMacOS();
  await execAsync('pmset displaysleepnow');
}

/** Lock screen */
export async function lockScreen(): Promise<void> {
  assertMacOS();
  await runAppleScript(`
    tell application "System Events" to keystroke "q" using {control down, command down}
  `);
}

/** Start screensaver */
export async function startScreensaver(): Promise<void> {
  assertMacOS();
  await execAsync('open -a ScreenSaverEngine');
}

// =============================================================================
// SPEECH
// =============================================================================

/** Speak text */
export async function say(text: string, voice?: string, rate?: number): Promise<void> {
  assertMacOS();

  let cmd = `say "${text.replace(/"/g, '\\"')}"`;
  if (voice) cmd += ` -v "${voice}"`;
  if (rate) cmd += ` -r ${rate}`;

  await execAsync(cmd);
}

/** Get available voices */
export async function getVoices(): Promise<string[]> {
  assertMacOS();
  const { stdout } = await execAsync('say -v ?');
  return stdout.trim().split('\n').map(line => line.split(/\s+/)[0]);
}

/** Stop speaking */
export function stopSpeaking(): void {
  if (!isMacOS()) return;
  try {
    execSync('killall say', { stdio: 'ignore' });
  } catch {}
}

// =============================================================================
// CLIPBOARD
// =============================================================================

/** Get clipboard content */
export async function getClipboard(): Promise<string> {
  assertMacOS();
  const { stdout } = await execAsync('pbpaste');
  return stdout;
}

/** Set clipboard content */
export async function setClipboard(text: string): Promise<void> {
  assertMacOS();
  await execAsync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
}

// =============================================================================
// KEYCHAIN
// =============================================================================

/** Get password from keychain */
export async function getKeychainPassword(service: string, account: string): Promise<string | null> {
  assertMacOS();

  try {
    const { stdout } = await execAsync(
      `security find-generic-password -s "${service}" -a "${account}" -w`
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Save password to keychain */
export async function setKeychainPassword(service: string, account: string, password: string): Promise<void> {
  assertMacOS();

  // Delete existing first (if any)
  try {
    await execAsync(`security delete-generic-password -s "${service}" -a "${account}"`);
  } catch {}

  await execAsync(
    `security add-generic-password -s "${service}" -a "${account}" -w "${password}"`
  );
}

/** Delete password from keychain */
export async function deleteKeychainPassword(service: string, account: string): Promise<void> {
  assertMacOS();

  await execAsync(`security delete-generic-password -s "${service}" -a "${account}"`);
}

// =============================================================================
// UTILITIES
// =============================================================================

function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Open URL in default browser */
export async function openUrl(url: string): Promise<void> {
  if (isMacOS()) {
    await execAsync(`open "${url}"`);
  } else {
    const { execSync } = require('child_process');
    const cmd = platform() === 'win32' ? 'start' : 'xdg-open';
    execSync(`${cmd} "${url}"`);
  }
}

/** Open file with default application */
export async function openFile(path: string, app?: string): Promise<void> {
  assertMacOS();

  if (app) {
    await execAsync(`open -a "${app}" "${path}"`);
  } else {
    await execAsync(`open "${path}"`);
  }
}

/** Get default application for file type */
export async function getDefaultApp(path: string): Promise<string | null> {
  assertMacOS();

  try {
    const { stdout } = await execAsync(
      `mdls -name kMDItemContentType "${path}" | grep kMDItemContentType | cut -d '"' -f2`
    );
    const contentType = stdout.trim();

    const { stdout: appPath } = await execAsync(
      `/usr/bin/defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers | plutil -extract 0 raw - 2>/dev/null || echo ""`
    );
    return appPath.trim() || null;
  } catch {
    return null;
  }
}

// =============================================================================
// EXPORT CHECK
// =============================================================================

export function isSupported(): boolean {
  return isMacOS();
}
