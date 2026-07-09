import { cp } from 'fs/promises';

await cp('src/system-prompt/templates', 'dist/system-prompt/templates', { recursive: true, force: true });
console.log('Templates copied to dist/system-prompt/templates');
