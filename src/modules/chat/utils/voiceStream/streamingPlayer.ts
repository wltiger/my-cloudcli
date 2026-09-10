import { PcmStreamPlayer } from '@/modules/chat/utils/voiceStream/pcmPlayer';
import { voiceDirectUrl } from '@/shared/api';
import { readVoiceConfig } from '@/shared/voiceConfig';
import { readVoiceStreamConfig } from '@/shared/voiceStreamConfig';

// Streaming counterpart to voicePlayer.ts: same subscribe/getSnapshot/
// toggle/unlock shape and the same "one play replaces the current one" /
// stale-result-suppression design (the `token` field), but fetches the
// backend's streaming+raw-PCM response instead of a blob, and plays it
// through PcmStreamPlayer instead of an <audio> element. Deliberately not
// merged into voicePlayer.ts — see docs/fork-customizations.md.

export type StreamingVoiceState = 'idle' | 'loading' | 'playing';
export type StreamingVoiceSnapshot = { state: StreamingVoiceState; error: string | null };

const IDLE: StreamingVoiceSnapshot = { state: 'idle', error: null };

class StreamingVoicePlayer {
  private pcmPlayer = new PcmStreamPlayer();
  private currentId: string | null = null;
  private state: StreamingVoiceState = 'idle';
  private errorId: string | null = null;
  private errorMsg: string | null = null;
  private token = 0;
  private activeController: AbortController | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  getSnapshot(id: string): StreamingVoiceSnapshot {
    const state = this.currentId === id ? this.state : 'idle';
    const error = this.errorId === id ? this.errorMsg : null;
    if (state === 'idle' && error === null) return IDLE;
    return { state, error };
  }

  unlock(): void {
    this.pcmPlayer.unlock();
  }

  toggle(content: string, id: string): void {
    if (this.currentId === id && (this.state === 'playing' || this.state === 'loading')) {
      this.stop();
      return;
    }
    void this.play(id, content);
  }

  stop(): void {
    this.token++;
    this.abortActive();
    this.pcmPlayer.stop();
    this.state = 'idle';
    this.currentId = null;
    this.emit();
  }

  private abortActive() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
  }

  private setError(id: string, msg: string) {
    this.state = 'idle';
    this.currentId = id;
    this.errorId = id;
    this.errorMsg = msg;
    this.emit();
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      if (this.errorId === id) {
        this.errorId = null;
        this.errorMsg = null;
        if (this.currentId === id) this.currentId = null;
        this.emit();
      }
    }, 6000);
  }

  private async play(id: string, content: string) {
    this.pcmPlayer.stop(); // supersede whatever this play replaces
    this.currentId = id;
    this.errorId = null;
    this.errorMsg = null;
    this.state = 'loading';
    this.emit();

    const myToken = ++this.token;
    this.abortActive();

    const config = readVoiceConfig();
    const instructions = readVoiceStreamConfig().instructions.trim();
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const response = await fetch(voiceDirectUrl(config.baseUrl.trim(), '/audio/speech'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.ttsModel || 'tts-1',
          voice: config.ttsVoice || 'alloy',
          input: content,
          stream: true,
          stream_format: 'audio',
          response_format: 'pcm',
          ...(instructions ? { instructions } : {}),
        }),
        signal: controller.signal,
      });
      if (myToken !== this.token) return;
      if (this.activeController === controller) this.activeController = null;

      if (!response.ok || !response.body) {
        let msg = `Read-aloud failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error) msg = String(body.error);
        } catch {
          /* non-JSON error body */
        }
        throw new Error(msg);
      }

      const reader = response.body.getReader();
      let receivedAnyBytes = false;
      let startedPlaying = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (myToken !== this.token) return;
        if (done) break;
        if (value && value.length > 0) {
          receivedAnyBytes = true;
          this.pcmPlayer.push(value);
          if (!startedPlaying) {
            startedPlaying = true;
            this.state = 'playing';
            this.emit();
          }
        }
      }

      // A "successful" response that delivered zero bytes is this backend's
      // signature for a silently-rejected/truncated request (§2.3 of the
      // backend's client docs) — treat it as a failure, not a quiet no-op.
      if (!receivedAnyBytes) {
        throw new Error('Read-aloud failed: the backend returned no audio (the text may be too long).');
      }

      await this.pcmPlayer.waitForDrain();
      if (myToken !== this.token) return;
      this.state = 'idle';
      this.currentId = null;
      this.emit();
    } catch (e) {
      if (myToken !== this.token) return;
      if (this.activeController === controller) this.activeController = null;
      const aborted = e instanceof Error && e.name === 'AbortError';
      this.setError(id, aborted ? 'Read-aloud stopped.' : e instanceof Error ? e.message : 'Read-aloud failed');
    }
  }
}

export const streamingVoicePlayer = new StreamingVoicePlayer();
