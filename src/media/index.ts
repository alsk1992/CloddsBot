/**
 * Media Pipeline - Clawdbot-style media handling
 *
 * Features:
 * - Download and store media files (images, audio, video, documents)
 * - MIME type detection
 * - Size limits and TTL-based cleanup
 * - Transcription hooks for audio/video
 * - Image resizing for vision models
 */

import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync as fsWriteFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join, basename, extname } from 'path';
import { pipeline } from 'stream/promises';
import * as https from 'https';
import * as http from 'http';
import { execFile, spawnSync } from 'child_process';
import { promisify } from 'util';
import { randomBytes } from 'crypto';
import { generateId as generateSecureId } from '../utils/id';
import { logger } from '../utils/logger';

// =============================================================================
// CONSTANTS
// =============================================================================

const MEDIA_DIR = join(homedir(), '.clodds', 'media');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB default
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Supported media types */
export type MediaType = 'image' | 'audio' | 'video' | 'document' | 'unknown';

/** MIME type mappings */
const MIME_TYPES: Record<string, { type: MediaType; ext: string }> = {
  'image/jpeg': { type: 'image', ext: '.jpg' },
  'image/png': { type: 'image', ext: '.png' },
  'image/gif': { type: 'image', ext: '.gif' },
  'image/webp': { type: 'image', ext: '.webp' },
  'image/svg+xml': { type: 'image', ext: '.svg' },
  'audio/mpeg': { type: 'audio', ext: '.mp3' },
  'audio/ogg': { type: 'audio', ext: '.ogg' },
  'audio/wav': { type: 'audio', ext: '.wav' },
  'audio/webm': { type: 'audio', ext: '.weba' },
  'audio/mp4': { type: 'audio', ext: '.m4a' },
  'video/mp4': { type: 'video', ext: '.mp4' },
  'video/webm': { type: 'video', ext: '.webm' },
  'video/quicktime': { type: 'video', ext: '.mov' },
  'application/pdf': { type: 'document', ext: '.pdf' },
  'text/plain': { type: 'document', ext: '.txt' },
  'application/json': { type: 'document', ext: '.json' },
};

// =============================================================================
// TYPES
// =============================================================================

/** Stored media file info */
export interface MediaFile {
  id: string;
  path: string;
  originalName?: string;
  mimeType: string;
  type: MediaType;
  size: number;
  createdAt: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
}

/** Download options */
export interface DownloadOptions {
  maxSize?: number;
  ttlMs?: number;
  originalName?: string;
  headers?: Record<string, string>;
}

/** Media service */
export interface MediaService {
  /** Download and store a file from URL */
  download(url: string, options?: DownloadOptions): Promise<MediaFile>;
  /** Store a file from buffer */
  store(buffer: Buffer, mimeType: string, options?: { originalName?: string; ttlMs?: number }): Promise<MediaFile>;
  /** Get a stored file */
  get(id: string): MediaFile | null;
  /** Delete a file */
  delete(id: string): boolean;
  /** Clean expired files */
  cleanup(): number;
  /** Get file path for a media ID */
  getPath(id: string): string | null;
  /** Read file as buffer */
  read(id: string): Buffer | null;
  /** Read file as base64 */
  readBase64(id: string): string | null;
  /** List all stored files */
  list(): MediaFile[];
}

// =============================================================================
// HELPERS
// =============================================================================

/** Ensure media directory exists */
function ensureMediaDir(): void {
  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
  }
}

/** Generate unique file ID */
function generateId(): string {
  return generateSecureId('media');
}

/** Detect MIME type from buffer magic bytes */
function detectMimeType(buffer: Buffer): string {
  // Check magic bytes
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // RIFF container - could be WEBP or WAV
    if (buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
    if (buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) return 'audio/wav';
  }
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return 'application/pdf';
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'audio/mpeg'; // ID3 tag
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg'; // MP3 frame sync
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'audio/ogg';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    // ftyp box - MP4/MOV
    const brand = buffer.slice(8, 12).toString('ascii');
    if (brand.startsWith('mp4') || brand === 'isom' || brand === 'avc1') return 'video/mp4';
    if (brand === 'qt  ' || brand.startsWith('M4A')) return 'video/quicktime';
  }
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video/webm';

  return 'application/octet-stream';
}

/** Get media type from MIME */
function getMediaType(mimeType: string): MediaType {
  const info = MIME_TYPES[mimeType];
  if (info) return info.type;
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('text/') || mimeType.startsWith('application/')) return 'document';
  return 'unknown';
}

/** Get file extension from MIME */
function getExtension(mimeType: string): string {
  const info = MIME_TYPES[mimeType];
  if (info) return info.ext;
  if (mimeType.startsWith('image/')) return '.bin';
  if (mimeType.startsWith('audio/')) return '.bin';
  if (mimeType.startsWith('video/')) return '.bin';
  return '.bin';
}

/** Download file from URL */
async function downloadFile(url: string, dest: string, options: DownloadOptions = {}, _redirectCount = 0): Promise<{ mimeType: string; size: number }> {
  if (_redirectCount > 10) {
    throw new Error('Too many redirects');
  }

  return new Promise((resolve, reject) => {
    const maxSize = options.maxSize ?? MAX_FILE_SIZE;
    const parsedUrl = new URL(url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const req = protocol.get(url, { headers: options.headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest, options, _redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      const contentLength = parseInt(res.headers['content-length'] || '0', 10);
      if (contentLength > maxSize) {
        reject(new Error(`File too large: ${contentLength} > ${maxSize}`));
        return;
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;

      res.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          res.destroy();
          reject(new Error(`File too large: exceeded ${maxSize} bytes`));
          return;
        }
        chunks.push(chunk);
      });

      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const mimeType = res.headers['content-type']?.split(';')[0] || detectMimeType(buffer);

        fsWriteFileSync(dest, buffer);

        resolve({ mimeType, size: buffer.length });
      });

      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// =============================================================================
// SERVICE
// =============================================================================

export function createMediaService(): MediaService {
  ensureMediaDir();

  // In-memory index of files (could be persisted to DB)
  const files = new Map<string, MediaFile>();

  try {
    const existing = readdirSync(MEDIA_DIR);
    for (const filename of existing) {
      const filePath = join(MEDIA_DIR, filename);
      const stat = statSync(filePath);
      if (!stat.isFile()) continue;
      const id = filename.replace(/\.[^.]+$/, '');
      const ext = extname(filename);
      const mimeEntry = Object.entries(MIME_TYPES).find(([, v]) => v.ext === ext);
      const mimeType = mimeEntry ? mimeEntry[0] : 'application/octet-stream';

      files.set(id, {
        id,
        path: filePath,
        mimeType,
        type: getMediaType(mimeType),
        size: stat.size,
        createdAt: stat.birthtime,
      });
    }
    if (existing.length > 0) {
      logger.debug({ count: existing.length }, 'Loaded existing media files');
    }
  } catch {
    // Directory might be empty or not exist yet
  }

  return {
    async download(url, options = {}) {
      const id = generateId();
      const tempPath = join(MEDIA_DIR, `${id}.tmp`);

      try {
        const { mimeType, size } = await downloadFile(url, tempPath, options);
        const ext = getExtension(mimeType);
        const finalPath = join(MEDIA_DIR, `${id}${ext}`);

        renameSync(tempPath, finalPath);

        const file: MediaFile = {
          id,
          path: finalPath,
          originalName: options.originalName || basename(new URL(url).pathname),
          mimeType,
          type: getMediaType(mimeType),
          size,
          createdAt: new Date(),
          expiresAt: options.ttlMs ? new Date(Date.now() + options.ttlMs) : undefined,
        };

        files.set(id, file);
        logger.info({ id, url, mimeType, size }, 'Media downloaded');

        return file;
      } catch (error) {
        // Clean up temp file
        try {
          unlinkSync(tempPath);
        } catch (err) { logger.warn({ error: err, path: tempPath }, 'Temp file cleanup failed'); }
        throw error;
      }
    },

    async store(buffer, mimeType, options = {}) {
      const id = generateId();
      const ext = getExtension(mimeType);
      const filePath = join(MEDIA_DIR, `${id}${ext}`);

      fsWriteFileSync(filePath, buffer);

      const file: MediaFile = {
        id,
        path: filePath,
        originalName: options.originalName,
        mimeType,
        type: getMediaType(mimeType),
        size: buffer.length,
        createdAt: new Date(),
        expiresAt: options.ttlMs ? new Date(Date.now() + options.ttlMs) : undefined,
      };

      files.set(id, file);
      logger.info({ id, mimeType, size: buffer.length }, 'Media stored');

      return file;
    },

    get(id) {
      return files.get(id) || null;
    },

    delete(id) {
      const file = files.get(id);
      if (!file) return false;

      try {
        unlinkSync(file.path);
      } catch (err) { logger.warn({ error: err, id, path: file.path }, 'Media file cleanup failed'); }

      files.delete(id);
      logger.debug({ id }, 'Media deleted');
      return true;
    },

    cleanup() {
      const now = Date.now();
      let deleted = 0;

      for (const [id, file] of files) {
        const age = now - file.createdAt.getTime();
        const expired = file.expiresAt && now > file.expiresAt.getTime();

        if (expired || age > DEFAULT_TTL_MS) {
          try {
            unlinkSync(file.path);
          } catch (err) { logger.warn({ error: err, id, path: file.path }, 'Expired media file cleanup failed'); }
          files.delete(id);
          deleted++;
        }
      }

      if (deleted > 0) {
        logger.info({ deleted }, 'Cleaned up expired media');
      }

      return deleted;
    },

    getPath(id) {
      const file = files.get(id);
      return file?.path || null;
    },

    read(id) {
      const file = files.get(id);
      if (!file) return null;

      try {
        return readFileSync(file.path);
      } catch {
        return null;
      }
    },

    readBase64(id) {
      const buffer = this.read(id);
      if (!buffer) return null;
      return buffer.toString('base64');
    },

    list() {
      return Array.from(files.values());
    },
  };
}

// =============================================================================
// TRANSCRIPTION
// =============================================================================

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
  engine?: 'openai' | 'whisper' | 'vosk';
}

export interface TranscriptionOptions {
  engine?: 'openai' | 'whisper' | 'vosk';
  language?: string;
  prompt?: string;
  model?: string;
  temperature?: number;
  timestamps?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface TranscriptionService {
  transcribe(audioPath: string, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  isAvailable(): boolean;
}

const execFileAsync = promisify(execFile);

const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 60_000;
const DEFAULT_TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_OPENAI_MODEL = process.env.CLODDS_TRANSCRIBE_MODEL?.trim() || 'gpt-4o-mini-transcribe';
const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.wav',
  '.webm',
  '.ogg',
]);

function commandExists(command: string): boolean {
  return Boolean(resolveCommand(command));
}

function resolveCommand(command: string): string | null {
  const whichResult = spawnSync('which', [command], { encoding: 'utf-8' });
  if (whichResult.status === 0 && whichResult.stdout) {
    const resolved = whichResult.stdout.trim();
    if (resolved) return resolved;
  }

  // Python user bin fallback: ~/Library/Python/*/bin/<command>
  const userPythonRoot = join(homedir(), 'Library', 'Python');
  if (!existsSync(userPythonRoot)) return null;

  try {
    const versions = readdirSync(userPythonRoot);
    for (const version of versions) {
      const candidate = join(userPythonRoot, version, 'bin', command);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore discovery errors; caller will handle null
  }

  return null;
}

function normalizeLanguage(language?: string): string | undefined {
  if (!language) return undefined;
  return language.split('-')[0]?.toLowerCase() || undefined;
}

function validateAudioFile(audioPath: string, options?: TranscriptionOptions): void {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const stats = statSync(audioPath);
  const envMaxBytes = Number(process.env.CLODDS_TRANSCRIBE_MAX_BYTES ?? 0);
  const maxBytes =
    options?.maxBytes ??
    (envMaxBytes > 0 ? envMaxBytes : DEFAULT_TRANSCRIBE_MAX_BYTES);
  if (stats.size > maxBytes) {
    throw new Error(`Audio file too large: ${stats.size} bytes (max ${maxBytes})`);
  }

  const ext = extname(audioPath).toLowerCase();
  if (ext && !SUPPORTED_AUDIO_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${Array.from(SUPPORTED_AUDIO_EXTENSIONS).join(', ')}`);
  }
}

function pickEngine(options?: TranscriptionOptions): 'openai' | 'whisper' | 'vosk' | null {
  const requested = options?.engine || (process.env.CLODDS_STT_ENGINE as TranscriptionOptions['engine'] | undefined);
  const openaiAvailable = Boolean(process.env.OPENAI_API_KEY);
  const whisperAvailable = commandExists('whisper');
  const voskAvailable = commandExists('vosk-transcriber');

  if (requested) {
    if (requested === 'openai' && openaiAvailable) return 'openai';
    if (requested === 'whisper' && whisperAvailable) return 'whisper';
    if (requested === 'vosk' && voskAvailable) return 'vosk';
    return null;
  }

  if (openaiAvailable) return 'openai';
  if (whisperAvailable) return 'whisper';
  if (voskAvailable) return 'vosk';
  return null;
}

async function transcribeWithOpenAI(audioPath: string, options: TranscriptionOptions, startedAt: number): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for OpenAI transcription');
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSCRIBE_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const fileBuffer = readFileSync(audioPath);
    const blob = new Blob([fileBuffer]);
    const form = new FormData();
    form.set('file', blob, basename(audioPath));
    form.set('model', options.model || DEFAULT_OPENAI_MODEL);

    const language = normalizeLanguage(options.language);
    if (language) form.set('language', language);
    if (options.prompt?.trim()) form.set('prompt', options.prompt.trim());
    if (typeof options.temperature === 'number') form.set('temperature', String(options.temperature));
    if (options.timestamps) {
      form.set('response_format', 'verbose_json');
    }

    const res = await fetch(OPENAI_TRANSCRIBE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });

    const data = (await res.json()) as {
      text?: string;
      language?: string;
      duration?: number;
      segments?: Array<{ start: number; end: number; text: string }>;
      error?: { message?: string };
    };

    if (!res.ok) {
      const detail = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(`OpenAI transcription failed: ${detail}`);
    }

    return {
      text: data.text || '',
      language: data.language || options.language,
      duration: data.duration,
      segments: data.segments,
      engine: 'openai',
    };
  } finally {
    clearTimeout(timeout);
    logger.debug({ ms: Date.now() - startedAt }, 'OpenAI transcription completed');
  }
}

async function transcribeWithWhisperCli(audioPath: string, options: TranscriptionOptions, startedAt: number): Promise<TranscriptionResult> {
  const language = normalizeLanguage(options.language) || 'en';
  const outputDir = mkdtempSync(join(tmpdir(), 'clodds-whisper-'));
  const base = basename(audioPath, extname(audioPath));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSCRIBE_TIMEOUT_MS;
  const whisperCmd = resolveCommand('whisper');
  if (!whisperCmd) {
    throw new Error('Whisper CLI not found. Install `openai-whisper` or add whisper to PATH.');
  }
  const ffmpegCmd = resolveCommand('ffmpeg');
  if (!ffmpegCmd) {
    throw new Error('ffmpeg not found. Whisper requires ffmpeg to decode audio.');
  }

  try {
    const args = [
      audioPath,
      '--language', language,
      '--task', 'transcribe',
      '--output_format', options.timestamps ? 'json' : 'txt',
      '--output_dir', outputDir,
    ];

    await execFileAsync(whisperCmd, args, { timeout: timeoutMs });

    const jsonPath = join(outputDir, `${base}.json`);
    const txtPath = join(outputDir, `${base}.txt`);

    if (options.timestamps && existsSync(jsonPath)) {
      const parsed = JSON.parse(readFileSync(jsonPath, 'utf-8')) as {
        text?: string;
        language?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
      };
      return {
        text: parsed.text || '',
        language: parsed.language || language,
        segments: parsed.segments,
        duration: Date.now() - startedAt,
        engine: 'whisper',
      };
    }

    if (existsSync(txtPath)) {
      const text = readFileSync(txtPath, 'utf-8');
      return {
        text: text.trim(),
        language,
        duration: Date.now() - startedAt,
        engine: 'whisper',
      };
    }

    throw new Error('Whisper CLI did not produce an output file');
  } finally {
    try {
      rmSync(outputDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
    logger.debug({ ms: Date.now() - startedAt }, 'Whisper CLI transcription completed');
  }
}

async function transcribeWithVoskCli(audioPath: string, options: TranscriptionOptions, startedAt: number): Promise<TranscriptionResult> {
  const language = options.language || 'en-US';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TRANSCRIBE_TIMEOUT_MS;
  const args = ['-l', language, '-i', audioPath];
  const voskCmd = resolveCommand('vosk-transcriber');
  if (!voskCmd) {
    throw new Error('vosk-transcriber not found. Install it or add it to PATH.');
  }
  const { stdout } = await execFileAsync(voskCmd, args, { timeout: timeoutMs });

  const parsed = JSON.parse(stdout) as {
    text?: string;
    confidence?: number;
    result?: Array<{ word: string; start?: number; end?: number }>;
  };

  const textFromWords = parsed.result?.map(r => r.word).filter(Boolean).join(' ').trim();
  const text = (parsed.text || textFromWords || '').trim();

  return {
    text,
    language,
    duration: Date.now() - startedAt,
    segments: text
      ? [{ start: 0, end: 0, text }]
      : undefined,
    engine: 'vosk',
  };
}

/** Create a transcription service with OpenAI + local CLI fallbacks */
export function createTranscriptionService(): TranscriptionService {
  return {
    async transcribe(audioPath: string, options: TranscriptionOptions = {}) {
      const startedAt = Date.now();
      validateAudioFile(audioPath, options);

      const engine = pickEngine(options);
      if (!engine) {
        throw new Error(
          'No transcription engine available. Configure OPENAI_API_KEY, install `whisper`, or install `vosk-transcriber`.'
        );
      }

      logger.info({ engine, audioPath }, 'Starting transcription');

      switch (engine) {
        case 'openai':
          return transcribeWithOpenAI(audioPath, options, startedAt);
        case 'whisper':
          return transcribeWithWhisperCli(audioPath, options, startedAt);
        case 'vosk':
          return transcribeWithVoskCli(audioPath, options, startedAt);
        default:
          throw new Error(`Unsupported transcription engine: ${engine as string}`);
      }
    },
    isAvailable() {
      return Boolean(
        process.env.OPENAI_API_KEY ||
        commandExists('whisper') ||
        commandExists('vosk-transcriber')
      );
    },
  };
}

// =============================================================================
// IMAGE PROCESSING
// =============================================================================

export interface ImageProcessingOptions {
  maxWidth?: number;
  maxHeight?: number;
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
}

export interface ImageProcessingService {
  resize(imagePath: string, options: ImageProcessingOptions): Promise<Buffer>;
  getInfo(imagePath: string): Promise<{ width: number; height: number; format: string }>;
}

async function loadSharp() {
  try {
    const mod = await import('sharp');
    // Handle both ESM and CJS module formats
    const sharpMod = (mod as unknown as { default?: typeof import('sharp') }).default ?? (mod as unknown as typeof import('sharp'));
    return sharpMod;
  } catch (error) {
    throw new Error(
      'Image processing requires the "sharp" package. Install it with: npm install sharp'
    );
  }
}

/** Create an image processing service */
export function createImageProcessingService(): ImageProcessingService {
  return {
    async resize(imagePath, _options) {
      const sharp = await loadSharp();
      const options = _options || {};
      const transformer = sharp(imagePath);

      if (options.maxWidth || options.maxHeight) {
        transformer.resize({
          width: options.maxWidth,
          height: options.maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      if (options.format) {
        transformer.toFormat(options.format, {
          quality: options.quality,
        });
      }

      return transformer.toBuffer();
    },
    async getInfo(imagePath) {
      const sharp = await loadSharp();
      const info = await sharp(imagePath).metadata();
      return {
        width: info.width || 0,
        height: info.height || 0,
        format: info.format || 'unknown',
      };
    },
  };
}

// =============================================================================
// VISION / IMAGE UNDERSTANDING (Claude Vision API)
// =============================================================================

export interface VisionAnalysis {
  description: string;
  objects?: string[];
  text?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  tags?: string[];
  confidence?: number;
}

export interface VisionService {
  /** Analyze image and describe contents */
  analyze(imagePathOrBuffer: string | Buffer, prompt?: string): Promise<VisionAnalysis>;
  /** Extract text from image (OCR) */
  extractText(imagePathOrBuffer: string | Buffer): Promise<string>;
  /** Describe image for accessibility */
  describeForAccessibility(imagePathOrBuffer: string | Buffer): Promise<string>;
  /** Check if vision is available */
  isAvailable(): boolean;
}

/** Create vision service using Claude API */
export function createVisionService(): VisionService {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  async function callClaudeVision(imageBase64: string, mimeType: string, prompt: string): Promise<string> {
    if (!apiKey) {
      throw new Error('Vision not configured. Set ANTHROPIC_API_KEY.');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType,
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        }],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vision API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text?: string }> };
    return data.content.find(c => c.type === 'text')?.text || '';
  }

  function getImageData(imagePathOrBuffer: string | Buffer): { base64: string; mimeType: string } {
    let buffer: Buffer;

    if (typeof imagePathOrBuffer === 'string') {
      buffer = readFileSync(imagePathOrBuffer);
    } else {
      buffer = imagePathOrBuffer;
    }

    // Detect MIME type
    let mimeType = 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8) mimeType = 'image/jpeg';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) mimeType = 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[8] === 0x57 && buffer[9] === 0x45) mimeType = 'image/webp';

    return {
      base64: buffer.toString('base64'),
      mimeType,
    };
  }

  return {
    async analyze(imagePathOrBuffer, prompt) {
      const { base64, mimeType } = getImageData(imagePathOrBuffer);

      const analysisPrompt = prompt ||
        'Analyze this image. Provide: 1) A brief description, 2) Main objects/subjects visible, 3) Any text visible, 4) Overall sentiment/mood. Format as JSON with keys: description, objects (array), text, sentiment.';

      const response = await callClaudeVision(base64, mimeType, analysisPrompt);

      // Try to parse as JSON, fall back to text description
      try {
        const parsed = JSON.parse(response);
        return {
          description: parsed.description || response,
          objects: parsed.objects,
          text: parsed.text,
          sentiment: parsed.sentiment,
          tags: parsed.tags,
        };
      } catch {
        return { description: response };
      }
    },

    async extractText(imagePathOrBuffer) {
      const { base64, mimeType } = getImageData(imagePathOrBuffer);

      const response = await callClaudeVision(
        base64,
        mimeType,
        'Extract and transcribe ALL text visible in this image. Include any signs, labels, captions, or written content. Return only the extracted text, preserving original formatting where possible.'
      );

      return response;
    },

    async describeForAccessibility(imagePathOrBuffer) {
      const { base64, mimeType } = getImageData(imagePathOrBuffer);

      const response = await callClaudeVision(
        base64,
        mimeType,
        'Describe this image for someone who cannot see it. Be concise but include all important visual details: main subject, colors, setting, text, and any relevant context. Keep under 150 words.'
      );

      return response;
    },

    isAvailable() {
      return !!apiKey;
    },
  };
}
