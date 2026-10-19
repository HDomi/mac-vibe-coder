import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FILE_ICON, DEFAULT_FOLDER_ICON, fileIconId, fileIconSvg } from '../web/src/lib/fileIcons';

test('file icons resolve by exact name before extension', () => {
  assert.equal(fileIconId('package.json', false), 'nodejs');
  assert.equal(fileIconId('Dockerfile', false), 'docker');
  assert.equal(fileIconId('.gitignore', false), 'git');
});

test('file icons prefer the longest multi-dot extension', () => {
  assert.equal(fileIconId('main.ts', false), 'typescript');
  assert.equal(fileIconId('app.test.ts', false), 'test-ts');
  assert.equal(fileIconId('bundle.js.map', false), 'javascript-map');
  assert.equal(fileIconId('NOTES.MD', false), 'markdown');
  assert.equal(fileIconId('README.md', false), 'readme');
});

test('unknown names fall back to the theme defaults', () => {
  assert.equal(fileIconId('weird.zzzqqq', false), DEFAULT_FILE_ICON);
  assert.equal(fileIconId('noext', false), DEFAULT_FILE_ICON);
  assert.equal(fileIconId('zzqq-unknown', true), DEFAULT_FOLDER_ICON);
  assert.equal(fileIconId('src', true), 'folder-src');
  assert.equal(fileIconId('node_modules', true), 'folder-node');
});

test('icon ids map to shipped svg file names', () => {
  assert.equal(fileIconSvg('typescript'), 'typescript.svg');
  assert.equal(fileIconSvg('nope-not-an-icon'), null);
});
