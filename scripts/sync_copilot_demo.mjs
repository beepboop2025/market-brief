// Import only a deliberately supplied, hash-verified Carrier export. No network or strategy execution.
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {readDemoPack} from '../docs/copilot-model.js';

const [file, expectedSHA256] = process.argv.slice(2);
if (!file || !/^[a-f0-9]{64}$/.test(expectedSHA256 ?? '')) throw new Error('Usage: node scripts/sync_copilot_demo.mjs PACK_JSON EXPECTED_SHA256');
const bytes = await fs.readFile(file);
const pack = await readDemoPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), expectedSHA256);
const ref = {path: 'copilot-pack.json', sha256: expectedSHA256, source_ref: pack.provenance.source_ref};
await fs.writeFile(fileURLToPath(new URL('../docs/copilot-pack.json', import.meta.url)), bytes);
await fs.writeFile(fileURLToPath(new URL('../docs/copilot-pack-ref.js', import.meta.url)), '// Original-byte integrity pin for the separately reviewed, synthetic Carrier export.\nexport const DEMO_PACK = Object.freeze(' + JSON.stringify(ref) + ');\n');
console.log(JSON.stringify({source: ref.source_ref, bytes: bytes.byteLength, sha256: ref.sha256, scenarios: pack.scenarios.length}));
