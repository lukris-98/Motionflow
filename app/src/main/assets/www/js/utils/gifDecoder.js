/**
 * Lightweight pure-JS GIF87a/89a frame-by-frame decoder.
 * Produces pre-composited Canvas frames + cumulative timestamps for frame-accurate playback & MP4 export.
 */
export async function decodeAnimatedGif(url) {
  const resp = await fetch(url);
  const buf = new Uint8Array(await resp.arrayBuffer());
  let pos = 0;

  const readByte = () => buf[pos++];
  const readU16 = () => {
    const v = buf[pos] | (buf[pos + 1] << 8);
    pos += 2;
    return v;
  };
  const readSubBlocks = () => {
    const chunks = [];
    let total = 0;
    while (pos < buf.length) {
      const len = readByte();
      if (len === 0) break;
      const slice = buf.subarray(pos, pos + len);
      chunks.push(slice);
      total += len;
      pos += len;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  };

  const sig = String.fromCharCode(...buf.subarray(0, 6));
  if (!sig.startsWith('GIF')) throw new Error('Not a GIF');
  pos = 6;

  const width = readU16();
  const height = readU16();
  const packed = readByte();
  const hasGct = (packed & 0x80) !== 0;
  const gctSize = 1 << ((packed & 0x07) + 1);
  readByte(); // bg index
  readByte(); // aspect

  let gct = null;
  if (hasGct) {
    gct = buf.subarray(pos, pos + gctSize * 3);
    pos += gctSize * 3;
  }

  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const compCtx = compCanvas.getContext('2d');

  const frames = [];
  let delayMs = 100;
  let transparentIndex = -1;
  let disposal = 0;
  let totalMs = 0;

  while (pos < buf.length) {
    const block = readByte();
    if (block === 0x3b) break; // Trailer
    if (block === 0x21) {
      const label = readByte();
      if (label === 0xf9) {
        readByte(); // block size (4)
        const gcePacked = readByte();
        disposal = (gcePacked >> 2) & 0x07;
        const hasTrans = (gcePacked & 0x01) !== 0;
        delayMs = Math.max(20, readU16() * 10);
        const tIdx = readByte();
        transparentIndex = hasTrans ? tIdx : -1;
        readByte(); // terminator
      } else {
        readSubBlocks();
      }
    } else if (block === 0x2c) {
      const left = readU16();
      const top = readU16();
      const fw = readU16();
      const fh = readU16();
      const imgPacked = readByte();
      const hasLct = (imgPacked & 0x80) !== 0;
      const interlaced = (imgPacked & 0x40) !== 0;
      const lctSize = 1 << ((imgPacked & 0x07) + 1);

      let colorTable = gct;
      if (hasLct) {
        colorTable = buf.subarray(pos, pos + lctSize * 3);
        pos += lctSize * 3;
      }

      const minCodeSize = readByte();
      const compressed = readSubBlocks();
      const indices = lzwDecode(minCodeSize, compressed, fw * fh);

      let prevBackup = null;
      if (disposal === 3) {
        prevBackup = compCtx.getImageData(0, 0, width, height);
      }

      const imgData = compCtx.createImageData(fw, fh);
      const data = imgData.data;

      const rowOrder = interlaced ? buildInterlaceRows(fh) : null;
      for (let y = 0; y < fh; y++) {
        const destY = rowOrder ? rowOrder[y] : y;
        for (let x = 0; x < fw; x++) {
          const idx = indices[y * fw + x];
          if (idx === transparentIndex) continue;
          const p = (destY * fw + x) * 4;
          const cOff = idx * 3;
          data[p] = colorTable[cOff];
          data[p + 1] = colorTable[cOff + 1];
          data[p + 2] = colorTable[cOff + 2];
          data[p + 3] = 255;
        }
      }

      // Draw patch onto composite canvas
      const patchCanvas = document.createElement('canvas');
      patchCanvas.width = fw;
      patchCanvas.height = fh;
      patchCanvas.getContext('2d').putImageData(imgData, 0, 0);
      compCtx.drawImage(patchCanvas, left, top);

      // Snapshot composited frame
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = width;
      frameCanvas.height = height;
      frameCanvas.getContext('2d').drawImage(compCanvas, 0, 0);

      frames.push({
        canvas: frameCanvas,
        startMs: totalMs,
        endMs: totalMs + delayMs
      });
      totalMs += delayMs;

      if (disposal === 2) {
        compCtx.clearRect(left, top, fw, fh);
      } else if (disposal === 3 && prevBackup) {
        compCtx.putImageData(prevBackup, 0, 0);
      }

      disposal = 0;
      transparentIndex = -1;
      delayMs = 100;
    } else {
      break;
    }
  }

  return { width, height, frames, totalMs: Math.max(100, totalMs) };
}

function buildInterlaceRows(height) {
  const rows = [];
  const passes = [[0, 8], [4, 8], [2, 4], [1, 2]];
  for (const [start, step] of passes) {
    for (let y = start; y < height; y += step) rows.push(y);
  }
  return rows;
}

function lzwDecode(minCodeSize, data, pixelCount) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;

  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  const out = new Uint8Array(pixelCount);

  const reset = () => {
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
    for (let i = 0; i < clearCode; i++) {
      prefix[i] = -1;
      suffix[i] = i;
    }
  };
  reset();

  let bitPos = 0;
  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byteIdx = bitPos >> 3;
      if (byteIdx >= data.length) return eoiCode;
      const bit = (data[byteIdx] >> (bitPos & 7)) & 1;
      code |= bit << i;
      bitPos++;
    }
    return code;
  };

  let outPos = 0;
  let oldCode = -1;
  let firstChar = 0;

  while (outPos < pixelCount) {
    const code = readCode();
    if (code === eoiCode) break;
    if (code === clearCode) {
      reset();
      oldCode = -1;
      continue;
    }

    let inCode = code;
    let sp = 0;
    if (code >= nextCode) {
      stack[sp++] = firstChar;
      inCode = oldCode;
    }
    while (inCode >= clearCode && sp < 4095) {
      stack[sp++] = suffix[inCode];
      inCode = prefix[inCode];
    }
    firstChar = suffix[inCode];
    stack[sp++] = firstChar;

    for (let i = sp - 1; i >= 0 && outPos < pixelCount; i--) {
      out[outPos++] = stack[i];
    }

    if (oldCode !== -1 && nextCode < 4096) {
      prefix[nextCode] = oldCode;
      suffix[nextCode] = firstChar;
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) {
        codeSize++;
      }
    }
    oldCode = code;
  }
  return out;
}
