// 輕量 ZIP 讀寫（不需外部套件）
// 讀：支援 store / deflate（用瀏覽器內建 DecompressionStream），直接從 File 切片讀取，不必整包載入記憶體
// 寫：store（不壓縮），圖片本來就壓縮過，速度快
(function (global) {
  'use strict';

  async function readZip(file) {
    const size = file.size;
    const tailLen = Math.min(size, 66000);
    const tail = new DataView(await file.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 檔');
    let count = tail.getUint16(eocd + 10, true);
    let cdSize = tail.getUint32(eocd + 12, true);
    let cdOff = tail.getUint32(eocd + 16, true);
    // ZIP64
    if (cdOff === 0xffffffff || count === 0xffff) {
      const loc = eocd - 20;
      if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
        const z64off = Number(tail.getBigUint64(loc + 8, true));
        const z = new DataView(await file.slice(z64off, z64off + 56).arrayBuffer());
        count = Number(z.getBigUint64(32, true));
        cdSize = Number(z.getBigUint64(40, true));
        cdOff = Number(z.getBigUint64(48, true));
      }
    }
    const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
    const entries = [];
    let p = 0;
    const dec = new TextDecoder();
    for (let n = 0; n < count && p < cd.byteLength; n++) {
      if (cd.getUint32(p, true) !== 0x02014b50) break;
      const method = cd.getUint16(p + 10, true);
      let csize = cd.getUint32(p + 20, true);
      let usize = cd.getUint32(p + 24, true);
      const nlen = cd.getUint16(p + 28, true);
      const elen = cd.getUint16(p + 30, true);
      const clen = cd.getUint16(p + 32, true);
      let lho = cd.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
      // ZIP64 extra field
      let e = p + 46 + nlen;
      const eEnd = e + elen;
      while (e + 4 <= eEnd) {
        const id = cd.getUint16(e, true), sz = cd.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (lho === 0xffffffff) { lho = Number(cd.getBigUint64(q, true)); q += 8; }
        }
        e += 4 + sz;
      }
      entries.push({ name, method, csize, usize, lho, file });
      p += 46 + nlen + elen + clen;
    }
    return entries;
  }

  async function entryData(en) {
    const h = new DataView(await en.file.slice(en.lho, en.lho + 30).arrayBuffer());
    const start = en.lho + 30 + h.getUint16(26, true) + h.getUint16(28, true);
    const blob = en.file.slice(start, start + en.csize);
    if (en.method === 0) return new Uint8Array(await blob.arrayBuffer());
    if (en.method === 8) {
      const ds = new DecompressionStream('deflate-raw');
      const buf = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
      return new Uint8Array(buf);
    }
    throw new Error('不支援的壓縮方式：' + en.method);
  }

  // ---- 寫 ----
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [], cd = [];
    let off = 0;
    for (const f of files) {
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const name = enc.encode(f.name);
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      if (off + 30 + name.length + data.length > 0xfffffff0 || files.length > 0xfffe)
        throw new Error('網站檔案總量超過 4 GB（或檔案數超過 65,000 個），超出這個工具能打包的上限。可以在整理頁用篩選隱藏部分貼文後再試。');
      parts.push(h.buffer, name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(c.buffer, name);
      off += 30 + name.length + data.length;
    }
    let cdLen = 0; cd.forEach(b => (cdLen += b.byteLength));
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, e.buffer], { type: 'application/zip' });
  }

  global.MiniZip = { readZip, entryData, makeZip };
})(window);
