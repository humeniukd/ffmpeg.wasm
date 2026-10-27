/**
 * 58-byte canonical WAVE header for 32-bit IEEE float (AudioFormat 3),
 * with the constant bytes baked in and the variable fields left zeroed:
 *
 *   "RIFF" ____ "WAVE" "fmt " 18 3 __ ____ ____ __ 32 0 "fact" 4 ____ "data" ____
 *
 * AudioFormat 3, BitsPerSample 32, cbSize 0, fact size 4.
 * Patched at runtime: ChunkSize, NumChannels, SampleRate, ByteRate,
 * BlockAlign, fact sample count, Subchunk2Size.
 *
 * Every zero byte must be written as \x00, never \0 — a \0 followed by a
 * digit is a legacy octal escape and is a SyntaxError in module scope.
 */
const HEADER_TEMPLATE = Uint8Array.from(
  "RIFF\x00\x00\x00\x00WAVEfmt \x12\x00\x00\x00\x03\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00 \x00\x00\x00fact\x04\x00\x00\x00\x00\x00\x00\x00data\x00\x00\x00\x00",
  c => c.charCodeAt(0),
);

const BYTES_PER_SAMPLE = 4; // format 3 => float32

export const wavHeader = (length, channels, sampleRate) => {
  const sampleCount = length/channels;
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const dataSize = length * BYTES_PER_SAMPLE;

  const bytes = HEADER_TEMPLATE.slice();
  const dataView = new DataView(bytes.buffer);

  dataView.setUint32(4, bytes.length - 8 + dataSize, true); // ChunkSize
  dataView.setUint16(22, channels, true);                   // NumChannels
  dataView.setUint32(24, sampleRate, true);                 // SampleRate
  dataView.setUint32(28, sampleRate * blockAlign, true);// ByteRate
  dataView.setUint16(32, blockAlign, true);                 // BlockAlign
  dataView.setUint32(46, sampleCount, true);                // fact sample count
  dataView.setUint32(54, dataSize, true);                   // Subchunk2Size

  return bytes;
};
