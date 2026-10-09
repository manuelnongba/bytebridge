import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTACHMENT_LANGUAGES,
  detectLanguage,
} from '../dist/typescript/renderer/debugging/languages.js';
import { APP_CONFIG } from '../dist/typescript/renderer/app-config.js';
import { readAttachment } from '../dist/typescript/renderer/debugging/data.js';

test('attachment detection covers extensions, uppercase names, and special filenames', () => {
  for (const [filename, language] of Object.entries({
    'Component.TSX': 'typescript',
    'widget.jsx': 'javascript',
    'main.rs': 'rust',
    'main.go': 'go',
    'App.java': 'java',
    'Main.cs': 'csharp',
    'native.hpp': 'cpp',
    'README.MD': 'markdown',
    'config.yml': 'yaml',
    'Cargo.toml': 'toml',
    'Dockerfile.server': 'dockerfile',
    'CMakeLists.txt': 'cmake',
    Makefile: 'makefile',
    Gemfile: 'ruby',
    '.env': 'ini',
    'component.vue': 'vue',
    'unknown.xyz': 'plaintext',
  }))
    assert.equal(detectLanguage(filename), language, filename);
});

test('registry drives dropdown options and supports configurable compound extensions', () => {
  assert.deepEqual(
    APP_CONFIG.debugging.collections[0].fields[1].options,
    ATTACHMENT_LANGUAGES.map((language) => language.id),
  );
  assert.equal(
    detectLanguage('x.special.ts', [
      { id: 'ts', extensions: ['.ts'] },
      { id: 'custom', extensions: ['.special.ts'] },
    ]),
    'custom',
  );
});

test('selected files use the expanded registry', async () => {
  const bytes = new TextEncoder().encode('fn main() {}');
  const attachment = await readAttachment(
    {
      name: 'MAIN.RS',
      size: bytes.length,
      arrayBuffer: async () => bytes.buffer,
    },
    APP_CONFIG.debugging,
  );

  assert.equal(attachment.language, 'rust');
});
