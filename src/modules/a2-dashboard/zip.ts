// Minimal, dependency-free ZIP (PKZIP) writer for the records-request full
// export (spec §7.6). Task instructions: use node's built-in zlib ONLY if
// trivially achievable without new deps; otherwise multiple CSV downloads
// with a manifest. Decision made here, documented for the journal: a valid
// ZIP archive using the STORE (method 0, uncompressed) entry format IS
// trivially achievable — the format is a well-documented, fixed binary
// layout (local file header + central directory + end-of-central-directory
// record) and needs no compression library, only CRC-32, which this file
// implements directly (the classic reflected-polynomial table algorithm,
// ~20 lines, no dependency). Every entry here is UTF-8 CSV text, so
// skipping compression costs little size for a real gain in simplicity and
// auditability — an official's ZIP client (Windows Explorer, macOS Archive
// Utility, 7-Zip) opens a STORE-method archive identically to a compressed
// one.

const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time encoding used by the ZIP local/central headers. Fixed
 * to a stable epoch timestamp (2026-01-01) rather than "now" — export
 * determinism is a minor nicety here, not a requirement, but avoids the
 * archive's internal timestamps leaking the exact export moment into a
 * document a jurisdiction might retain as a records-request artifact. */
function dosDateTime(): { time: number; date: number } {
  const time = (0 << 11) | (0 << 5) | 0; // 00:00:00
  const date = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
  return { time, date };
}

export interface ZipEntry {
  name: string;
  content: Buffer;
}

/** Builds a single valid ZIP archive (STORE method) from a list of named
 * buffers. Pure — returns the archive bytes, no filesystem/network I/O. */
export function buildZip(entries: readonly ZipEntry[]): Buffer {
  const { time, date } = dosDateTime();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.content);
    const size = entry.content.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method = 0 (STORE)
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localParts.push(local, nameBuf, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method = 0 (STORE)
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header

    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + entry.content.length;
  }

  const centralDirSize = centralParts.reduce((n, b) => n + b.length, 0);
  const centralDirOffset = offset;

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8); // entries on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralDirSize, 12);
  end.writeUInt32LE(centralDirOffset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, ...centralParts, end]);
}
