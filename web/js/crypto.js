// 端到端加密：服务器只看得到密文。
//
// - 密钥：第一台设备随机生成 32 字节，只存在本机（localStorage）。
// - 恢复码：把密钥写成 52 个 base32 字符 + 2 位校验，四个一组，用来把密钥带到别的设备上。
// - 加密：AES-256-GCM，每次随机 12 字节 IV；周号（2026-W42）作为附加认证数据，
//   服务器把 A 周的密文挪到 B 周会解密失败，不会被悄悄换掉。
// - 图片是二进制：同样的 AES-256-GCM，附加认证数据是图片的键（ID 或 ID+t），所以服务器把 A 图的密文挪成 B 图会解密失败；
//   格式是一行文本头「MYWEEK-E2EE/1 <指纹>」加换行，后面直接跟 IV（12 字节）|| 密文（原始字节，不做 base64）。
// - 密文格式（一个文本文件）：
//     MYWEEK-E2EE/1 <密钥指纹 8 位>
//     <base64(IV || 密文)>
//   密钥指纹 = SHA-256(密钥) 的前 4 字节，用来认出「这份密文是不是我这把钥匙加的」。
const E2EE = (() => {
  const KEY = "myweek-e2ee-key";
  const MAGIC = "MYWEEK-E2EE/1";
  const ALPH = "ABCDEFGHJKMNPQRSTVWXYZ0123456789"; // 32 个字符，去掉了容易看混的 I L O U
  const enc = new TextEncoder(), dec = new TextDecoder();

  const b64 = u8 => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, "0")).join("");
  const sha = async u8 => new Uint8Array(await crypto.subtle.digest("SHA-256", u8));

  function base32(u8) {
    let bits = 0, val = 0, out = "";
    for (const b of u8) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += ALPH[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += ALPH[(val << (5 - bits)) & 31];
    return out;
  }
  function unbase32(s, nBytes) {
    let bits = 0, val = 0; const out = [];
    for (const ch of s) {
      const i = ALPH.indexOf(ch); if (i < 0) throw new Error(tr("恢复码里有不认识的字符「{0}」", ch));
      val = (val << 5) | i; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    if (out.length < nBytes) throw new Error(tr("恢复码太短了"));
    return new Uint8Array(out.slice(0, nBytes));
  }

  let raw = null, cryptoKey = null, keyId = null;
  async function load(u8) {
    raw = u8;
    cryptoKey = await crypto.subtle.importKey("raw", u8, "AES-GCM", false, ["encrypt", "decrypt"]);
    keyId = hex((await sha(u8)).slice(0, 4));
  }
  async function init() {
    try { const s = localStorage.getItem(KEY); if (s) await load(unb64(s)); } catch (e) { raw = cryptoKey = keyId = null; }
  }
  const ready = init();

  async function recoveryCode() {
    if (!raw) return null;
    const check = base32((await sha(raw)).slice(0, 2)).slice(0, 2);   // 2 位校验，抄错一个字就能发现
    return (base32(raw) + check).match(/.{1,4}/g).join("-");
  }
  async function parseCode(code) {
    const s = code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
    if (s.length !== 54) throw new Error(tr("恢复码应该是 54 个字符，这里是 {0} 个", s.length));
    const u8 = unbase32(s.slice(0, 52), 32);
    const check = base32((await sha(u8)).slice(0, 2)).slice(0, 2);
    if (check !== s.slice(52)) throw new Error(tr("恢复码校验不通过，可能抄错了一个字"));
    return u8;
  }

  return {
    ready,
    get enabled() { return !!cryptoKey; },
    get keyId() { return keyId; },
    isEncrypted: text => text.startsWith(MAGIC + " "),
    blobKeyId: text => text.slice(MAGIC.length + 1, MAGIC.length + 9),
    // 生成一个新密钥的恢复码，先不装入：用户确认存好了，再用 useCode 装上
    async newCode() {
      const u8 = crypto.getRandomValues(new Uint8Array(32));
      const check = base32((await sha(u8)).slice(0, 2)).slice(0, 2);
      return (base32(u8) + check).match(/.{1,4}/g).join("-");
    },
    // 用恢复码在新设备上装入密钥
    async useCode(code) {
      const u8 = await parseCode(code);
      await load(u8); localStorage.setItem(KEY, b64(u8)); return keyId;
    },
    // 只校验、不装入：看看这串恢复码对应的指纹
    async idOfCode(code) { return hex((await sha(await parseCode(code))).slice(0, 4)); },
    recoveryCode,
    forget() { localStorage.removeItem(KEY); raw = cryptoKey = keyId = null; },
    async encrypt(text, weekId) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(weekId) }, cryptoKey, enc.encode(text)));
      const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
      return `${MAGIC} ${keyId}\n${b64(all)}\n`;
    },
    // 图片（二进制）：返回 / 接收 Uint8Array
    async encryptBytes(bytes, aad) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, cryptoKey, bytes));
      const head = enc.encode(`${MAGIC} ${keyId}\n`), out = new Uint8Array(head.length + 12 + ct.length);
      out.set(head); out.set(iv, head.length); out.set(ct, head.length + 12);
      return out;
    },
    async decryptBytes(bytes, aad) {
      const head = enc.encode(`${MAGIC} ${keyId}\n`);
      if (bytes.length < head.length + 12 || !head.every((b, i) => bytes[i] === b)) throw new Error(tr("这份数据是另一把密钥加密的，恢复码不对"));
      const iv = bytes.slice(head.length, head.length + 12);
      try { return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, cryptoKey, bytes.slice(head.length + 12))); }
      catch (e) { throw new Error(tr("{0} 解不开：密文损坏，或者被放错了周", aad)); }
    },
    async decrypt(blob, weekId) {
      const [head, body] = blob.split("\n");
      if (head.slice(MAGIC.length + 1) !== keyId) throw new Error(tr("这份数据是另一把密钥加密的，恢复码不对"));
      const all = unb64(body.trim());
      try {
        const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12), additionalData: enc.encode(weekId) }, cryptoKey, all.slice(12));
        return dec.decode(pt);
      } catch (e) { throw new Error(tr("{0} 解不开：密文损坏，或者被放错了周", weekId)); }
    },
  };
})();
