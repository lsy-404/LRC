const fs = require('fs');
const path = require('path');
const TOML = require('@iarna/toml');
const chardet = require('chardet');

const testFile = 'f:/Development/LRC/res/ELOHIM/info.toml';

console.log('=== TOML Parsing Test ===\n');

// Read raw buffer
const buffer = fs.readFileSync(testFile);
console.log('File size:', buffer.length, 'bytes');
console.log('First 20 bytes (hex):', buffer.slice(0, 20).toString('hex'));
console.log('');

// Detect encoding
const detected = chardet.detect(buffer);
console.log('Detected encoding:', detected);
console.log('');

// Try different approaches
const approaches = [
  { name: 'UTF-8 (direct)', fn: () => buffer.toString('utf-8') },
  { name: 'UTF-8 (iconv)', fn: () => require('iconv-lite').decode(buffer, 'utf-8') },
  { name: 'Detected encoding (iconv)', fn: () => require('iconv-lite').decode(buffer, detected) },
];

for (const approach of approaches) {
  try {
    const content = approach.fn();
    console.log(`\n--- ${approach.name} ---`);
    console.log('Content preview (first 100 chars):');
    console.log(content.slice(0, 100));
    console.log('\nDecoded content (first 200 chars):');
    console.log(JSON.stringify(content.slice(0, 200)));
    
    console.log('\nAttempting TOML parse...');
    const parsed = TOML.parse(content);
    console.log('SUCCESS! Parsed fields:');
    console.log('  年份:', parsed['年份']);
    console.log('  出品:', parsed['出品']);
    console.log('  演唱:', parsed['演唱']);
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}
