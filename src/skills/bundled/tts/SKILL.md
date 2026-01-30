---
name: tts
description: "Text-to-speech synthesis with ElevenLabs and system voices"
emoji: "🔊"
gates:
  envs:
    anyOf:
      - ELEVENLABS_API_KEY
---

# TTS (Text-to-Speech) - Complete API Reference

Convert text to natural-sounding speech using ElevenLabs, macOS say, or espeak.

---

## Chat Commands

### Synthesize Speech

```
/speak "Your order has been filled"         Speak text aloud
/speak "Market alert" --voice rachel        Use specific voice
/speak "Portfolio up 5%" --speed 1.2        Adjust speed
```

### Voice Management

```
/voices                                     List available voices
/voices preview rachel                      Preview a voice
/voice set rachel                           Set default voice
```

### Settings

```
/tts status                                 Check TTS status
/tts provider elevenlabs                    Set provider
/tts speed 1.0                              Set default speed
/tts volume 0.8                             Set volume (0-1)
```

---

## TypeScript API Reference

### Create TTS Service

```typescript
import { createTTSService } from 'clodds/tts';

const tts = createTTSService({
  provider: 'elevenlabs',
  apiKey: process.env.ELEVENLABS_API_KEY,

  // Defaults
  defaultVoice: 'rachel',
  defaultSpeed: 1.0,
  defaultPitch: 1.0,
});
```

### Synthesize Speech

```typescript
// Basic synthesis
const audio = await tts.synthesize('Hello, your trade was executed.');

// Play immediately
await tts.speak('Portfolio value is $10,000');

// With options
await tts.speak('Market alert: BTC crossed $100k', {
  voice: 'josh',
  speed: 1.2,
  pitch: 1.0,
  volume: 0.8,
});
```

### Streaming Synthesis

```typescript
// Stream for long text (lower latency)
const stream = await tts.streamSynthesize(longText, {
  voice: 'rachel',
});

stream.on('data', (chunk) => {
  // Play audio chunks as they arrive
  audioPlayer.write(chunk);
});

stream.on('end', () => {
  console.log('Synthesis complete');
});
```

### List Voices

```typescript
// Get available voices
const voices = await tts.listVoices();

for (const voice of voices) {
  console.log(`${voice.id}: ${voice.name}`);
  console.log(`  Gender: ${voice.gender}`);
  console.log(`  Accent: ${voice.accent}`);
  console.log(`  Use case: ${voice.useCase}`);
}
```

### Voice Preview

```typescript
// Preview a voice
await tts.preview('rachel', 'This is a preview of the Rachel voice.');
```

### Queue Management

```typescript
// Queue multiple messages
tts.queue('First message');
tts.queue('Second message');
tts.queue('Third message');

// Messages play in order

// Clear queue
tts.clearQueue();

// Skip current
tts.skip();
```

---

## ElevenLabs Voices

| Voice ID | Name | Gender | Accent | Best For |
|----------|------|--------|--------|----------|
| `rachel` | Rachel | F | American | Narration |
| `domi` | Domi | F | American | Conversational |
| `bella` | Bella | F | American | Soft, gentle |
| `antoni` | Antoni | M | American | Narration |
| `josh` | Josh | M | American | Deep, authoritative |
| `arnold` | Arnold | M | American | Gruff, character |
| `adam` | Adam | M | American | Deep, narration |
| `sam` | Sam | M | American | Raspy, character |

---

## Providers

| Provider | Quality | Latency | Cost | Setup |
|----------|---------|---------|------|-------|
| **ElevenLabs** | Premium | ~500ms | $5/100k chars | API key |
| **say** (macOS) | Good | ~100ms | Free | Built-in |
| **espeak** | Basic | ~50ms | Free | Install |

### Provider Configuration

```typescript
// ElevenLabs (best quality)
const tts = createTTSService({
  provider: 'elevenlabs',
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// macOS say (free, local)
const tts = createTTSService({
  provider: 'say',
  defaultVoice: 'Samantha',  // macOS voice
});

// espeak (cross-platform, free)
const tts = createTTSService({
  provider: 'espeak',
  defaultVoice: 'en-us',
});
```

---

## Audio Output

```typescript
// Set output device
tts.setOutputDevice('Built-in Speakers');

// Get available devices
const devices = await tts.listOutputDevices();
```

---

## SSML Support (ElevenLabs)

```typescript
// Use SSML for advanced control
await tts.speak(`
  <speak>
    <prosody rate="slow">Important alert:</prosody>
    <break time="500ms"/>
    Your stop loss was triggered.
  </speak>
`, { ssml: true });
```

---

## Best Practices

1. **Use streaming** — For long text, reduces time to first audio
2. **Cache common phrases** — "Order filled", "Alert triggered"
3. **Adjust speed** — Faster for alerts, slower for details
4. **Queue management** — Don't overlap important messages
5. **Fallback provider** — Use say/espeak if ElevenLabs unavailable
