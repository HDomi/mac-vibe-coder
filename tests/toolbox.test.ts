import assert from 'node:assert/strict';
import test from 'node:test';
import { base64Decode, base64Encode, base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8ToBytes } from '../web/src/lib/toolbox/bytes';
import { md5 } from '../web/src/lib/toolbox/md5';
import { decodeJwt, jwtTimeStatus, signHsJwt, verifyJwt } from '../web/src/lib/toolbox/jwt';
import { AES_DEFAULTS, aesDecrypt, aesEncrypt, digest, hmac, randomPassword, uuidV4, uuidV7 } from '../web/src/lib/toolbox/crypto';
import { convertBase, htmlDecode, htmlEncode, parseQuery, unicodeEscape, unicodeUnescape, urlDecode, urlEncode } from '../web/src/lib/toolbox/encode';
import { formatDuration, isoInZone, parseDuration, parseTime } from '../web/src/lib/toolbox/time';
import { diffLines, diffStats, unifiedDiff } from '../web/src/lib/toolbox/diff';
import { contrastRatio, formatColor, parseColor, toHex } from '../web/src/lib/toolbox/color';
import { convertCase, lineOp, textStats } from '../web/src/lib/toolbox/text';
import { errorPosition, jsonPath, parseLenient, searchJson, sortKeys, toTypeScript } from '../web/src/lib/toolbox/json';
import { runRegex, splitLiteral } from '../web/src/lib/toolbox/regex';

test('bytes: hex and base64 round-trip, url-safe and unpadded base64 decode', () => {
  const b = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  assert.equal(bytesToHex(b), '0001fafbfcfdfeff');
  assert.deepEqual(hexToBytes('00:01 fa-fb_fc fd fe ff'), b);
  assert.throws(() => hexToBytes('abc'), /Invalid hex/);
  assert.equal(bytesToBase64(b), 'AAH6+/z9/v8=');
  assert.equal(bytesToBase64(b, true), 'AAH6-_z9_v8');
  assert.deepEqual(base64ToBytes('AAH6-_z9_v8'), b);
  assert.equal(base64Decode(base64Encode('한글 ✓')), '한글 ✓');
  assert.throws(() => base64ToBytes('!!'), /Invalid base64/);
});

test('md5 matches RFC 1321 vectors and handles a block boundary', () => {
  assert.equal(md5(utf8ToBytes('')), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5(utf8ToBytes('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(md5(utf8ToBytes('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
  assert.equal(md5(utf8ToBytes('a'.repeat(56))), '3b0c8ac703f828b04c6c197006d17218');
  assert.equal(md5(utf8ToBytes('a'.repeat(64))), '014842d480b571495a4a0363793f7367');
});

test('jwt: decode, Bearer prefix, HS256 sign/verify, time status', async () => {
  const tok = await signHsJwt({ alg: 'HS256' }, { sub: '1', exp: 1_900_000_000 }, 'secret');
  const parts = decodeJwt(`Bearer ${tok}`);
  assert.deepEqual(parts.header, { typ: 'JWT', alg: 'HS256' });
  assert.equal(parts.payload.sub, '1');
  assert.equal(await verifyJwt(parts, 'secret'), true);
  assert.equal(await verifyJwt(parts, 'wrong'), false);
  assert.equal(jwtTimeStatus(parts.payload, 1_800_000_000_000), null);
  assert.deepEqual(jwtTimeStatus(parts.payload, 1_950_000_000_000), { claim: 'exp', at: 1_900_000_000 });
  assert.throws(() => decodeJwt('a.b'), /three/);
  assert.throws(() => decodeJwt('eyJ.eyJ.x'), /not base64url|not JSON/);
  await assert.rejects(verifyJwt({ ...parts, header: { alg: 'none' } }, 'x'), /Unsupported alg/);
});

test('jwt: RS256 verify with a PEM public key', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const b64u = (s: string) => Buffer.from(s).toString('base64url');
  const input = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ sub: 'x' }))}`;
  const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, Buffer.from(input))).toString('base64url');
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', kp.publicKey)).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
  assert.equal(await verifyJwt(decodeJwt(`${input}.${sig}`), pem), true);
  assert.equal(await verifyJwt(decodeJwt(`${input}.${sig.slice(0, -2)}AA`), pem), false);
});

test('aes: GCM and CBC round-trip with raw and passphrase keys; wrong key is a clean error', async () => {
  const gcm = { ...AES_DEFAULTS, key: '0123456789abcdef0123456789abcdef', iv: '000102030405060708090a0b', ivFormat: 'hex' as const };
  const c = await aesEncrypt('hello 세계', gcm);
  assert.equal(await aesDecrypt(c, gcm), 'hello 세계');
  await assert.rejects(aesDecrypt(c, { ...gcm, key: 'fedcba9876543210fedcba9876543210' }), /Decrypt failed/);
  await assert.rejects(aesEncrypt('x', { ...gcm, key: 'short' }), /16, 24 or 32/);
  const cbc = { ...AES_DEFAULTS, mode: 'AES-CBC' as const, keySource: 'passphrase' as const, key: 'pw', salt: 'salt', iterations: 1000, iv: '00'.repeat(16), ivFormat: 'hex' as const, dataFormat: 'hex' as const };
  const c2 = await aesEncrypt('block', cbc);
  assert.match(c2, /^[0-9a-f]{32}$/);
  assert.equal(await aesDecrypt(c2, cbc), 'block');
  await assert.rejects(aesEncrypt('x', { ...cbc, iv: '00' }), /16-byte IV/);
});

test('hash, hmac, uuid, password', async () => {
  assert.equal(await digest('SHA-256', utf8ToBytes('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await digest('MD5', utf8ToBytes('abc')), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(await hmac('SHA-256', utf8ToBytes('key'), utf8ToBytes('The quick brown fox jumps over the lazy dog')), 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  assert.match(uuidV4(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const v7 = uuidV7(0x0189_abcd_ef12);
  assert.ok(v7.startsWith('0189abcd-ef12-7'));
  const pw = randomPassword({ length: 12, upper: true, lower: true, digits: true, symbols: true });
  assert.equal(pw.length, 12);
  assert.ok(/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw));
  assert.equal(randomPassword({ length: 5, upper: false, lower: false, digits: false, symbols: false }), '');
});

test('encode: html, url, unicode, query, base', () => {
  assert.equal(htmlEncode('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(htmlDecode('&lt;&#65;&#x42;&nbsp;&hellip;&bogus;'), '<AB …&bogus;');
  assert.equal(urlEncode("a b&c/d(e)*'!"), 'a%20b%26c%2Fd%28e%29%2A%27%21');
  assert.equal(urlEncode('a b/c?d=e', false), 'a%20b/c?d=e');
  assert.equal(urlDecode('a+b%20c%ED%95%9C'), 'a b c한');
  assert.throws(() => urlDecode('%E0%A4%A'), /Malformed/);
  assert.equal(unicodeEscape('a한😀'), 'a\\ud55c\\u{1f600}');
  assert.equal(unicodeUnescape('a\\ud55c\\u{1f600}\\x41'), 'a한😀A');
  assert.deepEqual(parseQuery('https://x.y/p?a=1&b=two+words&c=%ED%95%9C&d'), [['a', '1'], ['b', 'two words'], ['c', '한'], ['d', '']]);
  assert.deepEqual(convertBase('0xff', 16), { 2: '11111111', 8: '377', 10: '255', 16: 'ff' });
  assert.deepEqual(convertBase('-1_000', 10), { 2: '-1111101000', 8: '-1750', 10: '-1000', 16: '-3e8' });
  assert.equal(convertBase('18446744073709551616', 10)[16], '10000000000000000');
  assert.throws(() => convertBase('12', 2), /base-2/);
});

test('time: unit detection, zones, durations', () => {
  assert.deepEqual(parseTime('1700000000'), { ms: 1700000000000, unit: 'seconds' });
  assert.deepEqual(parseTime('1700000000123'), { ms: 1700000000123, unit: 'milliseconds' });
  assert.equal(parseTime('1700000000123456').unit, 'microseconds');
  assert.equal(parseTime('1700000000123456789').unit, 'nanoseconds');
  assert.equal(parseTime('2024-01-02T03:04:05Z').ms, Date.UTC(2024, 0, 2, 3, 4, 5));
  assert.equal(parseTime('2024-01-02 03:04').ms, new Date(2024, 0, 2, 3, 4).getTime());
  assert.equal(parseTime('now', 42).ms, 42);
  assert.throws(() => parseTime('yesterday-ish'), /Unrecognized/);
  assert.equal(isoInZone(Date.UTC(2024, 0, 2, 3, 4, 5), 'Asia/Seoul'), '2024-01-02T12:04:05+09:00');
  assert.equal(isoInZone(Date.UTC(2024, 0, 2, 3, 4, 5, 7), 'UTC'), '2024-01-02T03:04:05.007Z');
  assert.equal(isoInZone(Date.UTC(2024, 6, 2, 3, 4, 5), 'America/New_York'), '2024-07-01T23:04:05-04:00');
  assert.equal(parseDuration('P1DT2H30M'), 95400000);
  assert.equal(parseDuration('PT0.5S'), 500);
  assert.throws(() => parseDuration('1h'), /duration/);
  assert.equal(formatDuration(95400000), '1d 2h 30m');
  assert.equal(formatDuration(1500), '1.5s');
  assert.equal(formatDuration(0), '0s');
});

test('diff: myers line diff and unified output', () => {
  const ops = diffLines('a\nb\nc\nd', 'a\nc\nd\ne');
  assert.deepEqual(ops.map((o) => `${o.type[0]}${o.line}`), ['ea', 'db', 'ec', 'ed', 'ie']);
  assert.deepEqual(diffStats(ops), { added: 1, removed: 1 });
  assert.deepEqual(diffLines('x', 'x').map((o) => o.type), ['equal']);
  assert.deepEqual(diffLines('', 'x').map((o) => o.type), ['delete', 'insert']);
  assert.deepEqual(diffLines('A  b', 'a b', { ignoreWhitespace: true, ignoreCase: true }).map((o) => o.type), ['equal']);
  const u = unifiedDiff(diffLines('1\n2\n3\n4\n5\n6\n7\n8\n9', '1\n2\n3\n4\nX\n6\n7\n8\n9'), 1);
  assert.equal(u, '--- a\n+++ b\n@@ -4,3 +4,3 @@\n 4\n-5\n+X\n 6');
});

test('color: parse formats, convert, contrast', () => {
  assert.deepEqual(parseColor('#f80'), { r: 255, g: 136, b: 0, a: 1 });
  assert.deepEqual(parseColor('#ff880080'), { r: 255, g: 136, b: 0, a: 128 / 255 });
  assert.deepEqual(parseColor('rgb(255, 136, 0)'), { r: 255, g: 136, b: 0, a: 1 });
  assert.deepEqual(parseColor('rgb(100% 50% 0% / 50%)'), { r: 255, g: 128, b: 0, a: 0.5 });
  assert.deepEqual(parseColor('hsl(32 100% 50%)'), { r: 255, g: 136, b: 0, a: 1 });
  assert.deepEqual(parseColor('navy'), { r: 0, g: 0, b: 128, a: 1 });
  assert.throws(() => parseColor('#12345'), /Unrecognized/);
  const f = formatColor(parseColor('#ff8800'));
  assert.equal(f.hex, '#ff8800');
  assert.equal(f.rgb, 'rgb(255 136 0)');
  assert.equal(f.hsl, 'hsl(32 100% 50%)');
  assert.equal(f.cmyk, 'cmyk(0% 47% 100% 0%)');
  assert.equal(toHex({ r: 1, g: 2, b: 3, a: 0.5 }), '#01020380');
  assert.equal(Math.round(contrastRatio(parseColor('#000'), parseColor('#fff'))), 21);
});

test('text: case conversion, stats, line ops', () => {
  assert.equal(convertCase('helloWorld foo_bar', 'snake'), 'hello_world_foo_bar');
  assert.equal(convertCase('hello world', 'camel'), 'helloWorld');
  assert.equal(convertCase('XMLHttpRequest', 'kebab'), 'xml-http-request');
  assert.equal(convertCase('a b\nc d', 'constant'), 'A_B\nC_D');
  assert.equal(convertCase('hello world', 'title'), 'Hello World');
  assert.deepEqual(textStats('Hi there.\n\nBye!'), { chars: 15, charsNoSpace: 12, bytes: 15, words: 3, lines: 3, sentences: 2, paragraphs: 2 });
  assert.equal(lineOp('b\na\nb', 'dedupe'), 'b\na');
  assert.equal(lineOp('10\n9\n2', 'sort'), '2\n9\n10');
  assert.equal(lineOp('  a\n   b', 'unindent'), 'a\n b');
  assert.equal(lineOp('a\nb', 'addNumbers'), '1  a\n2  b');
});

test('json: lenient parse, errors, paths, search, sort, typescript', () => {
  assert.deepEqual(parseLenient('{"a":1}'), { value: { a: 1 }, relaxed: false });
  assert.deepEqual(parseLenient("{a: 'x', b: [1,2,], // c\n}"), { value: { a: 'x', b: [1, 2] }, relaxed: true });
  assert.deepEqual(parseLenient('"{\\"n\\":1}"'), { value: { n: 1 }, relaxed: true });
  assert.throws(() => parseLenient('{"a":'), SyntaxError);
  let msg = '';
  try { JSON.parse('{"a":\n1,}'); } catch (e) { msg = (e as Error).message; }
  const pos = errorPosition(msg, '{"a":\n1,}');
  assert.ok(pos && pos.line === 2, msg);
  assert.equal(jsonPath(['a', 0, 'b c']), '$.a[0]["b c"]');
  assert.deepEqual(searchJson({ user: { name: 'Ann', tags: ['x', 'ann'] } }, 'ann'), [['user', 'name'], ['user', 'tags', 1]]);
  assert.equal(JSON.stringify(sortKeys({ b: { d: 1, c: 2 }, a: [{ z: 1, y: 2 }] })), '{"a":[{"y":2,"z":1}],"b":{"c":2,"d":1}}');
  assert.equal(toTypeScript({ id: 1, tags: ['a'], owner: { name: 'x', 'first-name': null } }), 'export interface Root {\n  id: number;\n  tags: string[];\n  owner: Owner;\n}\n\nexport interface Owner {\n  name: string;\n  "first-name": null;\n}');
  assert.equal(toTypeScript([1, 'a']), 'export type Root = (number | string)[];');
});

test('regex: literal split, matches with named groups, zero-length safety', () => {
  assert.deepEqual(splitLiteral('/a\\/b/gi'), { source: 'a\\/b', flags: 'gi' });
  assert.equal(splitLiteral('abc'), null);
  const m = runRegex('(?<y>\\d{4})-(\\d{2})', 'd', '2024-01 and 2025-02');
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].groups, [{ name: 'y', value: '2024', index: 0 }, { name: null, value: '01', index: 5 }]);
  assert.equal(runRegex('', '', 'abc').length, 4);
  assert.equal(runRegex('x*', 'g', 'xxa').length, 3);
});
