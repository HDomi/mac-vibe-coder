import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeSvg, parseXml, serialize, svgBase64Uri, svgDataUri, svgToReact, SVG_DEFAULTS } from '../web/src/lib/toolbox/svg';
import { buildIcns, buildIco, pngSize } from '../web/src/lib/toolbox/icons';
import { qrMatrix, qrSvg, wifiPayload } from '../web/src/lib/toolbox/qr';

const INKSCAPE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape -->
<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24.000000 24.000000" version="1.1" id="svg8" inkscape:version="1.2" sodipodi:docname="icon.svg">
  <sodipodi:namedview id="base" pagecolor="#ffffff"/>
  <metadata id="metadata5"><rdf:RDF/></metadata>
  <title>icon</title>
  <defs id="defs2"><linearGradient id="g1"><stop offset="0.000000" stop-color="#f00"/></linearGradient></defs>
  <g id="layer1" inkscape:label="Layer 1">
    <g>
      <path id="path10" style="fill:url(#g1); stroke-width:1.5000;" d="M 2.000000,3.123456 L 10.500000,20.0000 Z" data-name="Path 1"/>
      <text x="1" y="2">A &amp; B</text>
    </g>
  </g>
</svg>`;

test('svg: parse/serialize round trip and entity handling', () => {
  const t = parseXml('<a x="1 &amp; 2"><b/>t&lt;</a>');
  assert.equal(serialize(t), '<a x="1 &amp; 2"><b/>t&lt;</a>');
  assert.throws(() => parseXml('<a><b></a>'), /Mismatched/);
  assert.throws(() => parseXml('<a>'), /Unclosed/);
});

test('svg: optimize drops editor cruft, keeps referenced ids, rounds numbers', () => {
  const out = optimizeSvg(INKSCAPE);
  assert.equal(out, '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><defs><linearGradient id="g1"><stop offset="0" stop-color="#f00"/></linearGradient></defs><path style="fill:url(#g1);stroke-width:1.5000" d="M2 3.123L10.5 20Z"/><text x="1" y="2">A &amp; B</text></svg>');
  const lean = optimizeSvg(INKSCAPE, { ...SVG_DEFAULTS, removeDimensions: true, currentColor: true, keepTitle: true, precision: 1 });
  assert.match(lean, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 24 24">/);
  assert.match(lean, /<title>icon<\/title>/);
  assert.match(lean, /d="M2 3.1L10.5 20Z"/);
  assert.throws(() => optimizeSvg('<div/>'), /No <svg>/);
});

test('svg: React component and data URIs', () => {
  const react = svgToReact('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" class="i"><path stroke-width="2" fill-rule="evenodd" style="fill-opacity:0.5;color:red" d="M0 0h2"/></svg>');
  assert.equal(react, `import type { SVGProps } from 'react';

export default function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2" className="i" {...props}>
      <path strokeWidth="2" fillRule="evenodd" style={{ fillOpacity: 0.5, color: "red" }} d="M0 0h2" />
    </svg>
  );
}
`);
  assert.equal(svgDataUri('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 0"/></svg>'), "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%23fff' d='M0 0'/%3E%3C/svg%3E");
  assert.equal(svgBase64Uri('<svg/>'), 'data:image/svg+xml;base64,PHN2Zy8+');
});

test('ico and icns containers', () => {
  const png = (n: number) => { const b = new Uint8Array(24 + n); b.set([0x89, 0x50, 0x4e, 0x47]); new DataView(b.buffer).setUint32(16, n); new DataView(b.buffer).setUint32(20, n); return b; };
  const ico = buildIco([{ size: 32, data: png(32) }, { size: 16, data: png(16) }, { size: 256, data: png(256) }]);
  const dv = new DataView(ico.buffer);
  assert.deepEqual([dv.getUint16(2, true), dv.getUint16(4, true)], [1, 3]);
  assert.deepEqual([ico[6], ico[22], ico[38]], [16, 32, 0]);
  assert.equal(dv.getUint32(6 + 12, true), 6 + 48);
  assert.deepEqual(pngSize(ico.subarray(dv.getUint32(6 + 32 + 12, true))), { width: 256, height: 256 });
  assert.throws(() => buildIco([{ size: 512, data: png(1) }]), /256/);
  const icns = buildIcns(new Map([[16, png(16)], [32, png(32)], [1024, png(1024)]]));
  const idv = new DataView(icns.buffer);
  assert.equal(String.fromCharCode(...icns.subarray(0, 4)), 'icns');
  assert.equal(idv.getUint32(4), icns.length);
  assert.equal(String.fromCharCode(...icns.subarray(8, 12)), 'icp4');
  // 16, 32 (icp5) and 32 again as ic11 (16@2x), 1024 (ic10).
  const types: string[] = [];
  for (let p = 8; p < icns.length; p += idv.getUint32(p + 4)) types.push(String.fromCharCode(...icns.subarray(p, p + 4)));
  assert.deepEqual(types, ['icp4', 'icp5', 'ic10', 'ic11']);
});

test('qr: matrix, svg, wifi payload', () => {
  const m = qrMatrix('https://example.com', { ecc: 'M', margin: 2 });
  assert.equal(m.length, 25 + 4);
  assert.equal(m[2][2], true); // finder pattern corner inside the quiet zone
  assert.equal(m[0][0], false);
  const svg = qrSvg(m, { fg: '#000', bg: '#fff' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 29 29"/);
  assert.match(svg, /<rect width="29" height="29" fill="#fff"\/>/);
  assert.throws(() => qrMatrix('', { ecc: 'L', margin: 0 }), /Nothing/);
  assert.equal(wifiPayload('My;Net', 'p:w', 'WPA', false), 'WIFI:T:WPA;S:My\\;Net;P:p\\:w;;');
  assert.equal(wifiPayload('Open', '', 'nopass', true), 'WIFI:T:nopass;S:Open;H:true;;');
});

test('svg: Illustrator root attributes are dropped', () => {
  const out = optimizeSvg('<svg version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 24 24" xml:space="preserve"><path d="M0 0h1"/></svg>');
  assert.equal(out, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h1"/></svg>');
});
