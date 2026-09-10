// Pure byte-alignment/decoding for a streamed 16-bit little-endian PCM byte
// stream. Network chunk boundaries are not guaranteed to land on a 2-byte
// sample boundary — decoding a misaligned chunk without carrying the odd
// trailing byte forward corrupts every subsequent sample into noise. Kept
// free of AudioContext/fetch so the alignment logic is deterministically
// testable; the streaming player wraps this with actual playback.

export type DecodedPcmChunk = {
  samples: Int16Array;
  carry: Uint8Array;
};

export function decodePcmChunk(carry: Uint8Array, chunk: Uint8Array): DecodedPcmChunk {
  const merged = new Uint8Array(carry.length + chunk.length);
  merged.set(carry, 0);
  merged.set(chunk, carry.length);

  const alignedLength = merged.length - (merged.length % 2);
  const aligned = merged.subarray(0, alignedLength);
  const nextCarry = merged.slice(alignedLength);

  const sampleCount = aligned.length / 2;
  const samples = new Int16Array(sampleCount);
  const view = new DataView(aligned.buffer, aligned.byteOffset, aligned.byteLength);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = view.getInt16(i * 2, true);
  }

  return { samples, carry: nextCarry };
}
