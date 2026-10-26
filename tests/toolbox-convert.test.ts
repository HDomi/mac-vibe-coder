import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCurl, parseFetch, parseRequest, shellWords, toAxios, toCurl, toFetch, toPython } from '../web/src/lib/toolbox/curl';
import { convertData, detectFormat } from '../web/src/lib/toolbox/formats';
import { fieldSummary, nextRuns, parseCron } from '../web/src/lib/toolbox/cron';
import { applyExpr, fromOctal, fromSymbolic, toOctal, toSymbolic } from '../web/src/lib/toolbox/chmod';
import { escapeAs, unescapeAs, ESCAPE_KINDS } from '../web/src/lib/toolbox/escape';
import { calcLines, cssLengths, dataSizes, formatNumber } from '../web/src/lib/toolbox/calc';
import { formatSql, minifySql } from '../web/src/lib/toolbox/sql';

test('shell words: quotes, $-quotes, continuations', () => {
  assert.deepEqual(shellWords(`curl 'a b' "c \\"d\\"" $'e\\nf\\'g' h\\ i \\\n -X`), ['curl', 'a b', 'c "d"', "e\nf'g", 'h i', '-X']);
  assert.throws(() => shellWords(`curl 'oops`), /Unterminated/);
});

test('curl: Chrome-style command parses into a request', () => {
  const r = parseCurl(`curl 'https://api.example.com/v1/users?page=2' \\
  -H 'accept: application/json' \\
  -H 'authorization: Bearer abc.def' \\
  --data-raw $'{"name":"Ada","note":"it\\'s"}' \\
  --compressed`);
  assert.equal(r.method, 'POST');
  assert.equal(r.url, 'https://api.example.com/v1/users?page=2');
  assert.deepEqual(r.headers.slice(0, 2), [['accept', 'application/json'], ['authorization', 'Bearer abc.def']]);
  assert.equal(r.body, `{"name":"Ada","note":"it's"}`);
  assert.equal(r.compressed, true);
});

test('curl: bundled flags, -G, -u, --json, -F, -I', () => {
  const a = parseCurl('curl -sSL -XPUT example.com/x -d a=1 -d b=2');
  assert.deepEqual([a.method, a.url, a.body, a.followRedirects], ['PUT', 'http://example.com/x', 'a=1&b=2', true]);
  assert.equal(parseCurl('curl -G https://x.io -d q=1 --data-urlencode "s=a b"').url, 'https://x.io?q=1&s=a%20b');
  assert.deepEqual(parseCurl('curl -u user:pw https://x.io').headers, [['Authorization', 'Basic dXNlcjpwdw==']]);
  const j = parseCurl(`curl --json '{"a":1}' https://x.io`);
  assert.equal(j.method, 'POST');
  assert.deepEqual(j.headers, [['Content-Type', 'application/json'], ['Accept', 'application/json']]);
  assert.deepEqual(parseCurl('curl -F name=Ada -F avatar=@me.png https://x.io').form, [{ name: 'name', value: 'Ada', file: false }, { name: 'avatar', value: 'me.png', file: true }]);
  assert.equal(parseCurl('curl -I https://x.io').method, 'HEAD');
  assert.throws(() => parseCurl('wget x'), /Not a curl/);
  assert.throws(() => parseCurl('curl -H "a: b"'), /No URL/);
});

test('fetch: dev tools copy parses; generators round-trip through curl', () => {
  const f = parseFetch(`fetch("https://x.io/api", {
    "headers": { "content-type": "application/json", "x-id": "7" },
    "body": "{\\"a\\":1}",
    "method": "POST",
    "mode": "cors"
  });`);
  assert.deepEqual([f.method, f.url, f.body], ['POST', 'https://x.io/api', '{"a":1}']);
  assert.deepEqual(f.headers, [['content-type', 'application/json'], ['x-id', '7']]);
  const back = parseCurl(toCurl(f));
  assert.deepEqual([back.method, back.url, back.body, back.headers], [f.method, f.url, f.body, f.headers]);
  assert.equal(toCurl({ method: 'GET', url: 'https://x.io/a b', headers: [] }, false), "curl 'https://x.io/a b'");
  assert.equal(toCurl({ method: 'DELETE', url: 'https://x.io', headers: [], body: "it's" }, false), "curl https://x.io -X DELETE --data-raw 'it'\\''s'");
  assert.match(toFetch(f), /body: JSON\.stringify\(\{\n {4}"a": 1\n {2}\}\)/);
  assert.match(toAxios(f), /method: "post"/);
  assert.match(toPython(f), /payload = \{\n {4}"a": 1,\n\}/);
  assert.match(toPython(f), /requests\.post\("https:\/\/x\.io\/api", headers=headers, json=payload\)/);
  assert.equal(parseRequest('curl https://a.b').url, 'https://a.b');
  assert.equal(parseRequest("fetch('https://a.b')").method, 'GET');
});

test('formats: detect and convert JSON / YAML / TOML', () => {
  assert.equal(detectFormat('{"a":1}'), 'json');
  assert.equal(detectFormat('[server]\nport = 80'), 'toml');
  assert.equal(detectFormat('a: 1\nb: [x, y]'), 'yaml');
  assert.equal(convertData('a: 1\nb:\n  - x\n  - y\n', 'auto', 'json').output, '{\n  "a": 1,\n  "b": [\n    "x",\n    "y"\n  ]\n}');
  assert.equal(convertData('{"name":"x","server":{"port":80}}', 'json', 'toml').output.trim(), 'name = "x"\n\n[server]\nport = 80');
  assert.equal(convertData('title = "t"\n[owner]\nname = "Ada"', 'toml', 'yaml').output, 'title: t\nowner:\n  name: Ada\n');
  assert.throws(() => convertData('{"a":null}', 'json', 'toml'), /no null/);
  assert.throws(() => convertData('[1,2]', 'json', 'toml'), /table/);
  assert.throws(() => convertData('a: [1', 'yaml', 'json'));
});

test('cron: parse, describe fields, next runs', () => {
  const s = parseCron('*/15 9-17 * * MON-FRI');
  assert.equal(fieldSummary(s.minute, 0), '0, 15, 30, 45');
  assert.equal(fieldSummary(s.dow, 4), 'MON, TUE, WED, THU, FRI');
  // Friday 2026-10-23 17:50 UTC -> next is Monday 09:00.
  const runs = nextRuns(s, 3, Date.UTC(2026, 9, 23, 17, 50), true).map((d) => d.toISOString());
  assert.deepEqual(runs, ['2026-10-26T09:00:00.000Z', '2026-10-26T09:15:00.000Z', '2026-10-26T09:30:00.000Z']);
  assert.deepEqual(nextRuns(parseCron('@monthly'), 2, Date.UTC(2026, 0, 31, 12), true).map((d) => d.toISOString()), ['2026-02-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z']);
  // Both day fields restricted: either matches (POSIX).
  assert.deepEqual(nextRuns(parseCron('0 0 13 * 5'), 2, Date.UTC(2026, 0, 1), true).map((d) => d.toISOString().slice(0, 10)), ['2026-01-02', '2026-01-09']);
  assert.equal(nextRuns(parseCron('0 0 29 2 *'), 1, Date.UTC(2026, 0, 1), true)[0].toISOString().slice(0, 10), '2028-02-29');
  assert.ok(parseCron('0 0 * * 7').dow.values.has(0));
  assert.throws(() => parseCron('* * * *'), /5 fields/);
  assert.throws(() => parseCron('0 * * * * *'), /seconds/);
  assert.throws(() => parseCron('60 * * * *'), /out of range/);
  assert.throws(() => parseCron('0 0 L * *'), /not supported/);
});

test('chmod: octal, symbolic, ls column, expressions', () => {
  assert.equal(toSymbolic(fromOctal('755')), 'rwxr-xr-x');
  assert.equal(toSymbolic(fromOctal('4755')), 'rwsr-xr-x');
  assert.equal(toSymbolic(fromOctal('1777')), 'rwxrwxrwt');
  assert.equal(toSymbolic(fromOctal('2644')), 'rw-r-Sr--');
  assert.equal(toOctal(fromSymbolic('-rw-r--r--@')), '644');
  assert.equal(toOctal(fromSymbolic('drwxr-sr-x  5 me staff 160 Oct 1 dir')), '2755');
  assert.equal(toOctal(applyExpr(fromOctal('644'), 'u+x,go-r')), '700');
  assert.equal(toOctal(applyExpr(fromOctal('600'), 'a+X')), '600');
  assert.equal(toOctal(applyExpr(fromOctal('700'), 'a+X')), '711');
  assert.equal(toOctal(applyExpr(fromOctal('777'), 'o=r')), '774');
  assert.equal(toOctal(applyExpr(fromOctal('755'), '+t')), '1755');
  assert.throws(() => fromOctal('8'), /Octal/);
  assert.throws(() => applyExpr(fromOctal('644'), 'z+q'), /Bad clause/);
});

test('escape: every kind round-trips', () => {
  const sample = `He said "it's" \\ $HOME \`x\` \${y} a.b*c\n\ttab, 한글!`;
  for (const k of ESCAPE_KINDS) assert.equal(unescapeAs(escapeAs(sample, k), k), sample, k);
  assert.equal(escapeAs("it's", 'shellSingle'), `'it'\\''s'`);
  assert.equal(escapeAs("O'Neil", 'sql'), `'O''Neil'`);
  assert.equal(escapeAs('a.b', 'regex'), 'a\\.b');
  assert.equal(escapeAs('a,b', 'csv'), '"a,b"');
  assert.equal(escapeAs('plain', 'csv'), 'plain');
  assert.equal(escapeAs('é', 'json', { asciiOnly: true }), '\\u00e9');
  assert.equal(escapeAs('é\n', 'c'), '\\u00e9\\n');
});

test('calc: precedence, functions, variables, units', () => {
  const vals = (s: string) => calcLines(s).map((l) => l.error ?? l.value);
  assert.deepEqual(vals('1 + 2 * 3\n(1 + 2) * 3\n2 ^ 3 ^ 2\n-2 ** 2\n0xff + 0b1 + 1_000\n10 % 3'), [7, 9, 512, -4, 1256, 1]);
  assert.deepEqual(vals('x = 4\nsqrt(x) + max(1, 7, 3)\nans * 2\n1 << 4 | 1\n50% * 200\nround(pi, 2)'), [4, 9, 18, 17, 100, 3.14]);
  assert.deepEqual(vals('# note\n\nfoo(1)\n1 +'), [undefined, undefined, 'Unknown function foo', 'Unexpected end']);
  assert.equal(formatNumber(1234567), '1,234,567');
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  const css = cssLengths(24, 'px', { base: 16, vw: 1440, vh: 900 });
  assert.equal(css.rem, 1.5);
  assert.equal(css.pt, 18);
  assert.equal(cssLengths(1, 'in', { base: 16, vw: 1440, vh: 900 }).px, 96);
  const d = dataSizes(1, 'GiB');
  assert.equal(d.MiB, 1024);
  assert.equal(d.B, 1073741824);
  assert.equal(dataSizes(8, 'bit').B, 1);
});

test('sql: format via sql-formatter, minify keeps quoted text', () => {
  assert.equal(formatSql('select a, b from t where x = 1', { dialect: 'sql', keywordCase: 'upper', indent: 2, linesBetween: 1 }), 'SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1');
  assert.equal(minifySql("SELECT  a,\n  b -- comment\nFROM t /* x */ WHERE s = 'a  -- not a comment' ;"), "SELECT a,b FROM t WHERE s = 'a  -- not a comment';");
  assert.equal(minifySql('select ( 1 , 2 )'), 'select (1,2)');
});
