// Small, uncompressed ZIP archives for already compressed JPEGs. No remote or file I/O.
const MAX_BYTES = 64 * 1024 * 1024;
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createPartnerImagesZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  if (files.length < 1 || files.length > 400) throw new Error("INVALID_ARCHIVE");
  const names = new Set<string>();
  let total = 0;
  const rows = files.map(file => {
    if (!/^page-\d{3}-photo-\d{2}\.jpg$/.test(file.name) || names.has(file.name)) throw new Error("INVALID_ARCHIVE");
    names.add(file.name);
    total += file.bytes.byteLength;
    if (total > MAX_BYTES) throw new Error("ARCHIVE_TOO_LARGE");
    return { ...file, nameBytes: new TextEncoder().encode(file.name), crc: crc32(file.bytes) };
  });
  const directoryLength = rows.reduce((sum, row) => sum + 46 + row.nameBytes.length, 0);
  const localLength = rows.reduce((sum, row) => sum + 30 + row.nameBytes.length + row.bytes.length, 0);
  const bytes = new Uint8Array(localLength + directoryLength + 22);
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const u32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  let local = 0, directory = localLength;
  for (const row of rows) {
    u32(local, 0x04034b50); u16(local + 4, 20); u16(local + 12, 33); // 1980-01-01
    u32(local + 14, row.crc); u32(local + 18, row.bytes.length); u32(local + 22, row.bytes.length);
    u16(local + 26, row.nameBytes.length);
    bytes.set(row.nameBytes, local + 30); bytes.set(row.bytes, local + 30 + row.nameBytes.length);
    u32(directory, 0x02014b50); u16(directory + 4, 20); u16(directory + 6, 20); u16(directory + 14, 33);
    u32(directory + 16, row.crc); u32(directory + 20, row.bytes.length); u32(directory + 24, row.bytes.length);
    u16(directory + 28, row.nameBytes.length); u32(directory + 42, local);
    bytes.set(row.nameBytes, directory + 46);
    local += 30 + row.nameBytes.length + row.bytes.length;
    directory += 46 + row.nameBytes.length;
  }
  u32(directory, 0x06054b50); u16(directory + 8, rows.length); u16(directory + 10, rows.length);
  u32(directory + 12, directoryLength); u32(directory + 16, localLength);
  return bytes;
}
