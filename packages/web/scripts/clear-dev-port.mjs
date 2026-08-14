import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const portFile = resolve(import.meta.dirname, '..', '.dev-port');
await unlink(portFile).catch((error) => {
  if (error?.code !== 'ENOENT') throw error;
});
