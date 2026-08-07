import { watch, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

let dir = dirname(fileURLToPath(import.meta.url));
while (true) {
  if (existsSync(resolve(dir, 'package.json'))) break;
  const parent = resolve(dir, '..');
  if (parent === dir) break;
  dir = parent;
}
const portFile = resolve(dir, '.dev-port');

if (existsSync(portFile)) process.exit(0);

await new Promise<void>((resolvePromise) => {
  const w = watch(dir, (_event, filename) => {
    if (filename === '.dev-port') {
      w.close();
      resolvePromise();
    }
  });
});
await new Promise((r) => setTimeout(r, 300));
