/**
 * Voice Module - Voice Wake + Talk Mode
 *
 * Features:
 * - Wake word detection
 * - Speech-to-text (STT)
 * - Text-to-speech (TTS)
 * - Voice activity detection
 * - Continuous listening mode
 */

import { EventEmitter } from 'events';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createWriteStream, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

// =============================================================================
// TYPES
// =============================================================================

export interface VoiceConfig {
  wakeWord?: string;
  language?: string;
  sttEngine?: 'whisper' | 'vosk' | 'google' | 'azure';
  ttsEngine?: 'say' | 'espeak' | 'google' | 'azure' | 'elevenlabs';
  sampleRate?: number;
  sensitivity?: number;
  silenceThreshold?: number;
  silenceDuration?: number;
  audioDevice?: string;
}

export interface STTResult {
  text: string;
  confidence: number;
  language?: string;
  duration: number;
}

export interface TTSConfig {
  voice?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
  duration: number;
}

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';

// =============================================================================
// VOICE RECOGNITION
// =============================================================================

export class VoiceRecognition extends EventEmitter {
  private config: Required<VoiceConfig>;
  private process: ChildProcess | null = null;
  private isListening = false;

  constructor(config: VoiceConfig = {}) {
    super();
    this.config = {
      wakeWord: config.wakeWord || 'hey clodds',
      language: config.language || 'en-US',
      sttEngine: config.sttEngine || 'whisper',
      ttsEngine: config.ttsEngine || 'say',
      sampleRate: config.sampleRate || 16000,
      sensitivity: config.sensitivity || 0.5,
      silenceThreshold: config.silenceThreshold || 500,
      silenceDuration: config.silenceDuration || 1500,
      audioDevice: config.audioDevice || 'default',
    };
  }

  /** Check if voice recognition is available */
  async isAvailable(): Promise<boolean> {
    try {
      switch (this.config.sttEngine) {
        case 'whisper':
          await execAsync('which whisper');
          return true;
        case 'vosk':
          await execAsync('which vosk-transcriber');
          return true;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /** Start listening for voice input */
  async startListening(): Promise<void> {
    if (this.isListening) return;

    this.isListening = true;
    this.emit('listening:start');
    logger.info('Voice recognition started');

    // Record audio using sox or arecord
    const tempFile = join(tmpdir(), `clodds-audio-${randomBytes(4).toString('hex')}.wav`);

    try {
      // Use sox to record audio
      const recordProcess = spawn('sox', [
        '-d',
        '-r', String(this.config.sampleRate),
        '-c', '1',
        '-b', '16',
        tempFile,
        'silence', '1', '0.1', '1%',
        '1', String(this.config.silenceDuration / 1000), '1%',
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.process = recordProcess;

      recordProcess.on('close', async () => {
        if (existsSync(tempFile)) {
          const result = await this.transcribe(tempFile);
          this.emit('transcription', result);

          // Check for wake word
          if (result.text.toLowerCase().includes(this.config.wakeWord.toLowerCase())) {
            this.emit('wakeword', result);
          }

          // Clean up
          try {
            unlinkSync(tempFile);
          } catch {}
        }

        // Continue listening if still enabled
        if (this.isListening) {
          this.startListening();
        }
      });

      recordProcess.on('error', (error) => {
        this.emit('error', error);
        this.isListening = false;
      });
    } catch (error) {
      this.emit('error', error);
      this.isListening = false;
    }
  }

  /** Stop listening */
  stopListening(): void {
    this.isListening = false;
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.emit('listening:stop');
    logger.info('Voice recognition stopped');
  }

  /** Transcribe an audio file */
  async transcribe(audioPath: string): Promise<STTResult> {
    const startTime = Date.now();

    switch (this.config.sttEngine) {
      case 'whisper':
        return this.transcribeWithWhisper(audioPath, startTime);
      case 'vosk':
        return this.transcribeWithVosk(audioPath, startTime);
      default:
        throw new Error(`Unsupported STT engine: ${this.config.sttEngine}`);
    }
  }

  private async transcribeWithWhisper(audioPath: string, startTime: number): Promise<STTResult> {
    try {
      const { stdout } = await execAsync(
        `whisper "${audioPath}" --language ${this.config.language.split('-')[0]} --output_format txt --output_dir ${tmpdir()} 2>/dev/null`
      );

      return {
        text: stdout.trim(),
        confidence: 0.9, // Whisper doesn't provide confidence
        language: this.config.language,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        text: '',
        confidence: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  private async transcribeWithVosk(audioPath: string, startTime: number): Promise<STTResult> {
    try {
      const { stdout } = await execAsync(`vosk-transcriber -l ${this.config.language} -i "${audioPath}"`);
      const result = JSON.parse(stdout);

      return {
        text: result.text || '',
        confidence: result.confidence || 0.8,
        language: this.config.language,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        text: '',
        confidence: 0,
        duration: Date.now() - startTime,
      };
    }
  }

  /** Record audio for a specific duration */
  async record(durationMs: number): Promise<string> {
    const tempFile = join(tmpdir(), `clodds-recording-${randomBytes(4).toString('hex')}.wav`);
    const durationSec = durationMs / 1000;

    await execAsync(
      `sox -d -r ${this.config.sampleRate} -c 1 -b 16 "${tempFile}" trim 0 ${durationSec}`
    );

    return tempFile;
  }
}

// =============================================================================
// TEXT TO SPEECH
// =============================================================================

export class TextToSpeech extends EventEmitter {
  private config: Required<VoiceConfig>;
  private speakingProcess: ChildProcess | null = null;

  constructor(config: VoiceConfig = {}) {
    super();
    this.config = {
      wakeWord: config.wakeWord || 'hey clodds',
      language: config.language || 'en-US',
      sttEngine: config.sttEngine || 'whisper',
      ttsEngine: config.ttsEngine || 'say',
      sampleRate: config.sampleRate || 16000,
      sensitivity: config.sensitivity || 0.5,
      silenceThreshold: config.silenceThreshold || 500,
      silenceDuration: config.silenceDuration || 1500,
      audioDevice: config.audioDevice || 'default',
    };
  }

  /** Check if TTS is available */
  async isAvailable(): Promise<boolean> {
    try {
      switch (this.config.ttsEngine) {
        case 'say':
          await execAsync('which say');
          return true;
        case 'espeak':
          await execAsync('which espeak');
          return true;
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /** Speak text */
  async speak(text: string, options?: TTSConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      this.emit('speaking:start', { text });

      switch (this.config.ttsEngine) {
        case 'say':
          this.speakWithSay(text, options, resolve, reject);
          break;
        case 'espeak':
          this.speakWithEspeak(text, options, resolve, reject);
          break;
        default:
          reject(new Error(`Unsupported TTS engine: ${this.config.ttsEngine}`));
      }
    });
  }

  private speakWithSay(
    text: string,
    options: TTSConfig | undefined,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const args = [];

    if (options?.voice) {
      args.push('-v', options.voice);
    }

    if (options?.rate) {
      args.push('-r', String(options.rate));
    }

    args.push(text);

    const proc = spawn('say', args, { stdio: 'inherit' });
    this.speakingProcess = proc;

    proc.on('close', (code) => {
      this.speakingProcess = null;
      this.emit('speaking:end');
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`say exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      this.speakingProcess = null;
      this.emit('speaking:error', error);
      reject(error);
    });
  }

  private speakWithEspeak(
    text: string,
    options: TTSConfig | undefined,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const args = [];

    if (options?.voice) {
      args.push('-v', options.voice);
    }

    if (options?.rate) {
      args.push('-s', String(options.rate));
    }

    if (options?.pitch) {
      args.push('-p', String(options.pitch));
    }

    args.push(text);

    const proc = spawn('espeak', args, { stdio: 'inherit' });
    this.speakingProcess = proc;

    proc.on('close', (code) => {
      this.speakingProcess = null;
      this.emit('speaking:end');
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`espeak exited with code ${code}`));
      }
    });

    proc.on('error', (error) => {
      this.speakingProcess = null;
      this.emit('speaking:error', error);
      reject(error);
    });
  }

  /** Stop speaking */
  stop(): void {
    if (this.speakingProcess) {
      this.speakingProcess.kill();
      this.speakingProcess = null;
      this.emit('speaking:stop');
    }
  }

  /** Check if currently speaking */
  isSpeaking(): boolean {
    return this.speakingProcess !== null;
  }

  /** Get available voices */
  async getVoices(): Promise<string[]> {
    switch (this.config.ttsEngine) {
      case 'say': {
        const { stdout } = await execAsync('say -v ?');
        return stdout.split('\n')
          .filter(Boolean)
          .map(line => line.split(/\s+/)[0]);
      }
      case 'espeak': {
        const { stdout } = await execAsync('espeak --voices');
        return stdout.split('\n')
          .slice(1)
          .filter(Boolean)
          .map(line => line.split(/\s+/)[4]);
      }
      default:
        return [];
    }
  }

  /** Synthesize speech to a file */
  async synthesize(text: string, outputPath: string, options?: TTSConfig): Promise<void> {
    switch (this.config.ttsEngine) {
      case 'say': {
        const args = ['-o', outputPath, '--data-format=LEF32@22050'];
        if (options?.voice) args.push('-v', options.voice);
        if (options?.rate) args.push('-r', String(options.rate));
        args.push(text);
        await execAsync(`say ${args.join(' ')}`);
        break;
      }
      case 'espeak': {
        const args = ['-w', outputPath];
        if (options?.voice) args.push('-v', options.voice);
        if (options?.rate) args.push('-s', String(options.rate));
        args.push(`"${text}"`);
        await execAsync(`espeak ${args.join(' ')}`);
        break;
      }
    }
  }
}

// =============================================================================
// VOICE ASSISTANT
// =============================================================================

export class VoiceAssistant extends EventEmitter {
  private recognition: VoiceRecognition;
  private tts: TextToSpeech;
  private state: VoiceState = 'idle';
  private isEnabled = false;
  private conversationCallback?: (text: string) => Promise<string>;

  constructor(config: VoiceConfig = {}) {
    super();
    this.recognition = new VoiceRecognition(config);
    this.tts = new TextToSpeech(config);

    this.setupListeners();
  }

  private setupListeners(): void {
    this.recognition.on('wakeword', () => {
      if (this.state === 'idle') {
        this.onWakeWord();
      }
    });

    this.recognition.on('transcription', (result: STTResult) => {
      if (this.state === 'listening' && result.text) {
        this.onTranscription(result);
      }
    });

    this.recognition.on('error', (error) => {
      this.emit('error', error);
      this.state = 'idle';
    });

    this.tts.on('speaking:end', () => {
      if (this.isEnabled) {
        this.state = 'listening';
        this.recognition.startListening();
      }
    });
  }

  /** Start the voice assistant */
  async start(): Promise<void> {
    const sttAvailable = await this.recognition.isAvailable();
    const ttsAvailable = await this.tts.isAvailable();

    if (!sttAvailable) {
      throw new Error('Speech recognition not available');
    }

    if (!ttsAvailable) {
      throw new Error('Text-to-speech not available');
    }

    this.isEnabled = true;
    this.state = 'idle';
    this.recognition.startListening();

    logger.info('Voice assistant started');
    this.emit('start');
  }

  /** Stop the voice assistant */
  stop(): void {
    this.isEnabled = false;
    this.recognition.stopListening();
    this.tts.stop();
    this.state = 'idle';

    logger.info('Voice assistant stopped');
    this.emit('stop');
  }

  /** Set the conversation handler */
  onConversation(callback: (text: string) => Promise<string>): void {
    this.conversationCallback = callback;
  }

  /** Get current state */
  getState(): VoiceState {
    return this.state;
  }

  /** Speak a response */
  async say(text: string): Promise<void> {
    const previousState = this.state;
    this.state = 'speaking';
    this.recognition.stopListening();

    await this.tts.speak(text);

    if (this.isEnabled) {
      this.state = previousState;
      if (this.state === 'listening') {
        this.recognition.startListening();
      }
    }
  }

  private async onWakeWord(): Promise<void> {
    this.state = 'listening';
    this.emit('wakeword');
    logger.debug('Wake word detected');

    // Play a sound or give feedback
    await this.say('Yes?');
  }

  private async onTranscription(result: STTResult): Promise<void> {
    // Skip wake word phrase
    const wakeWord = this.recognition['config'].wakeWord.toLowerCase();
    let text = result.text.toLowerCase();
    if (text.startsWith(wakeWord)) {
      text = text.slice(wakeWord.length).trim();
    }

    if (!text) return;

    this.state = 'processing';
    this.emit('input', { text, confidence: result.confidence });

    if (this.conversationCallback) {
      try {
        const response = await this.conversationCallback(text);
        await this.say(response);
      } catch (error) {
        await this.say("I'm sorry, I encountered an error.");
      }
    }

    if (this.isEnabled) {
      this.state = 'listening';
    }
  }

  /** Get the recognition instance */
  getRecognition(): VoiceRecognition {
    return this.recognition;
  }

  /** Get the TTS instance */
  getTTS(): TextToSpeech {
    return this.tts;
  }
}

// =============================================================================
// WAKE WORD DETECTOR
// =============================================================================

export class WakeWordDetector extends EventEmitter {
  private wakeWords: string[];
  private recognition: VoiceRecognition;
  private isRunning = false;

  constructor(wakeWords: string[] = ['hey clodds', 'okay clodds']) {
    super();
    this.wakeWords = wakeWords.map(w => w.toLowerCase());
    this.recognition = new VoiceRecognition();

    this.recognition.on('transcription', (result: STTResult) => {
      const text = result.text.toLowerCase();
      for (const wakeWord of this.wakeWords) {
        if (text.includes(wakeWord)) {
          this.emit('detected', { wakeWord, text, confidence: result.confidence });
          break;
        }
      }
    });
  }

  /** Start detecting wake words */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.recognition.startListening();
    this.emit('start');
  }

  /** Stop detecting */
  stop(): void {
    this.isRunning = false;
    this.recognition.stopListening();
    this.emit('stop');
  }

  /** Add a wake word */
  addWakeWord(word: string): void {
    const lower = word.toLowerCase();
    if (!this.wakeWords.includes(lower)) {
      this.wakeWords.push(lower);
    }
  }

  /** Remove a wake word */
  removeWakeWord(word: string): void {
    const lower = word.toLowerCase();
    const index = this.wakeWords.indexOf(lower);
    if (index !== -1) {
      this.wakeWords.splice(index, 1);
    }
  }

  /** Get configured wake words */
  getWakeWords(): string[] {
    return [...this.wakeWords];
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createVoiceRecognition(config?: VoiceConfig): VoiceRecognition {
  return new VoiceRecognition(config);
}

export function createTextToSpeech(config?: VoiceConfig): TextToSpeech {
  return new TextToSpeech(config);
}

export function createVoiceAssistant(config?: VoiceConfig): VoiceAssistant {
  return new VoiceAssistant(config);
}

export function createWakeWordDetector(wakeWords?: string[]): WakeWordDetector {
  return new WakeWordDetector(wakeWords);
}

// =============================================================================
// DEFAULT INSTANCES
// =============================================================================

export const voiceRecognition = new VoiceRecognition();
export const textToSpeech = new TextToSpeech();
export const voiceAssistant = new VoiceAssistant();
