import assert from 'node:assert/strict';

import { test } from 'vitest';

import { decodePcmChunk } from '@/modules/chat/utils/voiceStream/pcmAlign';

const EMPTY = new Uint8Array(0);

test('decodePcmChunk decodes a single even-length chunk with no carry', () => {
  // Int16 LE: 1000 (0x03E8) then -5000 (0xEC78)
  const chunk = new Uint8Array([0xe8, 0x03, 0x78, 0xec]);
  const { samples, carry } = decodePcmChunk(EMPTY, chunk);
  assert.deepEqual(Array.from(samples), [1000, -5000]);
  assert.equal(carry.length, 0);
});

test('decodePcmChunk carries a trailing odd byte instead of dropping or misaligning it', () => {
  const chunk = new Uint8Array([0xe8, 0x03, 0x78]); // 1000, then a lone leading byte of -5000
  const { samples, carry } = decodePcmChunk(EMPTY, chunk);
  assert.deepEqual(Array.from(samples), [1000]);
  assert.deepEqual(Array.from(carry), [0x78]);
});

test('decodePcmChunk reassembles a sample split across two chunk-boundary calls', () => {
  const first = decodePcmChunk(EMPTY, new Uint8Array([0xe8, 0x03, 0x78]));
  assert.deepEqual(Array.from(first.samples), [1000]);

  const second = decodePcmChunk(first.carry, new Uint8Array([0xec]));
  assert.deepEqual(Array.from(second.samples), [-5000]);
  assert.equal(second.carry.length, 0);
});

test('decodePcmChunk handles several consecutive odd-length chunks without ever growing the carry past one byte', () => {
  // Same 4 bytes as the first test, delivered one byte at a time.
  const bytes = [0xe8, 0x03, 0x78, 0xec];
  let carry: Uint8Array = EMPTY;
  const collected: number[] = [];
  for (const byte of bytes) {
    const result = decodePcmChunk(carry, new Uint8Array([byte]));
    assert.ok(result.carry.length <= 1, 'carry must never exceed one byte');
    collected.push(...Array.from(result.samples));
    carry = result.carry;
  }
  assert.deepEqual(collected, [1000, -5000]);
  assert.equal(carry.length, 0);
});

test('decodePcmChunk handles an empty chunk without losing an existing carry', () => {
  const first = decodePcmChunk(EMPTY, new Uint8Array([0xe8, 0x03, 0x78]));
  const withEmptyChunk = decodePcmChunk(first.carry, EMPTY);
  assert.equal(withEmptyChunk.samples.length, 0);
  assert.deepEqual(Array.from(withEmptyChunk.carry), [0x78]);

  const finished = decodePcmChunk(withEmptyChunk.carry, new Uint8Array([0xec]));
  assert.deepEqual(Array.from(finished.samples), [-5000]);
});
