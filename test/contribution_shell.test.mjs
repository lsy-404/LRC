import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const contributionGuide = new URL('../docs/contribute/README.md', import.meta.url);
const workstation = new URL('../docs/contribute/workstation.md', import.meta.url);
const styles = new URL('../docs/.vuepress/styles/index.scss', import.meta.url);

test('contribution routes use the isolated full-width workspace shell', async () => {
  for (const file of [contributionGuide, workstation]) {
    const source = await readFile(file, 'utf8');

    assert.match(source, /^sidebar: false$/m);
    assert.match(source, /^toc: false$/m);
    assert.match(source, /^containerClass: contribution-workspace$/m);
  }
});

test('contribution workspace CSS only removes document width constraints in its route shell', async () => {
  const source = await readFile(styles, 'utf8');

  assert.match(source, /\.theme-container\.contribution-workspace/);
  assert.match(source, /\[vp-content\]:not\(\.custom\),/);
  assert.match(source, /max-width:\s*none/);
  assert.match(source, /padding-inline:\s*clamp\(1rem, 3vw, 3rem\)/);
});

test('workstation markdown contains only the title and application mount', async () => {
  const source = await readFile(workstation, 'utf8');
  const body = source.split('\n---\n', 2)[1].trim();

  assert.equal(body, '<ClientOnly>\n  <Workbench />\n</ClientOnly>');
});
