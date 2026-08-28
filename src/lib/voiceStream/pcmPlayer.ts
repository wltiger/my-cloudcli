import { decodePcmChunk } from './pcmAlign';

// Schedules a live 24kHz mono 16-bit PCM byte stream onto the Web Audio
// timeline as chunks arrive, so playback starts from the first chunk instead
// of waiting for the whole response. Ported from the backend vendor's own
// browser test page. Not unit-tested: AudioContext doesn't exist under
// Node's test runner (see pcmAlign.ts for the tested byte-alignment core
// this wraps); verified manually in a real browser instead.

const SAMPLE_RATE = 24000;
const SCHEDULING_LOOKAHEAD_SECONDS = 0.02;

type AudioContextConstructor = typeof AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor {
  const withWebkit = window as unknown as { webkitAudioContext?: AudioContextConstructor };
  const ctor = window.AudioContext ?? withWebkit.webkitAudioContext;
  if (!ctor) throw new Error('Web Audio is not supported in this browser.');
  return ctor;
}

export class PcmStreamPlayer {
  private audioContext: AudioContext | null = null;
  private carry: Uint8Array = new Uint8Array(0);
  private nextStartTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private drainListener: (() => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      const Ctor = resolveAudioContextConstructor();
      this.audioContext = new Ctor();
    }
    if (this.audioContext.state === 'suspended') {
      void this.audioContext.resume();
    }
    return this.audioContext;
  }

  // Call synchronously within the click gesture so iOS/Safari grant audio
  // playback, mirroring voicePlayer.unlock()'s role for the <audio> element.
  unlock(): void {
    this.ensureContext();
  }

  push(chunk: Uint8Array): void {
    const { samples, carry } = decodePcmChunk(this.carry, chunk);
    this.carry = carry;
    if (samples.length === 0) return;

    const context = this.ensureContext();
    const float32 = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      float32[i] = samples[i] / 32768;
    }
    const buffer = context.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    const startAt = Math.max(context.currentTime + SCHEDULING_LOOKAHEAD_SECONDS, this.nextStartTime || context.currentTime);
    source.start(startAt);
    this.sources.push(source);
    source.onended = () => {
      const index = this.sources.indexOf(source);
      if (index >= 0) this.sources.splice(index, 1);
      if (this.sources.length === 0) this.drainListener?.();
    };
    this.nextStartTime = startAt + buffer.duration;
  }

  // Resolves once every currently-scheduled chunk has finished playing.
  // Call after the network stream itself has ended (not before — chunks
  // scheduled after this resolves won't be waited for).
  waitForDrain(): Promise<void> {
    if (this.sources.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      this.drainListener = resolve;
    });
  }

  // Stops every scheduled-but-unplayed source and resets the timeline.
  // Aborting only the network request would leave already-buffered audio
  // audible for seconds afterward, since generation outruns playback.
  stop(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already stopped/ended */
      }
    }
    this.sources = [];
    this.carry = new Uint8Array(0);
    this.nextStartTime = 0;
    if (this.drainListener) {
      const listener = this.drainListener;
      this.drainListener = null;
      listener();
    }
  }
}
