/* eslint-disable */
const fs = require('fs');
const path = require('path');

// Basic valid 1x1 green PNG buffer generator scaled up
function createSimplePngBuffer(width, height) {
  // A minimal valid PNG buffer with green theme #10B981
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // IHDR
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x06, 0x00, 0x00, 0x00, // 8-bit RGBA
  ]);
  
  // Minimal PNG chunk data for solid green icon
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const scanlines = [];
  for (let y = 0; y < height; y++) {
    scanlines.push(0x00); // Filter byte
    for (let x = 0; x < width; x++) {
      scanlines.push(0x10, 0xb9, 0x81, 0xff); // RGBA (16, 185, 129, 255) #10b981
    }
  }
  
  const zlib = require('zlib');
  const compressedData = zlib.deflateSync(Buffer.from(scanlines));
  
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  const makeChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    const crcVal = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crcVal, 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };

  const ihdrData = Buffer.from([
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x06, 0x00, 0x00, 0x00,
  ]);

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdrChunk,
    idatChunk,
    iendChunk,
  ]);
}

const publicDir = path.join(__dirname, '..', '..', 'public');
fs.writeFileSync(path.join(publicDir, 'icon-192.png'), createSimplePngBuffer(192, 192));
fs.writeFileSync(path.join(publicDir, 'icon-512.png'), createSimplePngBuffer(512, 512));
fs.writeFileSync(path.join(publicDir, 'icon-maskable-512.png'), createSimplePngBuffer(512, 512));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createSimplePngBuffer(180, 180));

console.log('PNG Icons successfully generated in public/');
