import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CliOptions {
  root: string;
  prefix: string;
  containerPath: string;
  appDir?: string;
  force: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    root: process.cwd(),
    prefix: 'api/rem',
    containerPath: '@/lib/container',
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--root': opts.root = argv[++i]; break;
      case '--prefix': opts.prefix = argv[++i].replace(/^\/|\/$/g, ''); break;
      case '--container-path': opts.containerPath = argv[++i]; break;
      case '--app-dir': opts.appDir = argv[++i]; break;
      case '--force': opts.force = true; break;
      default:
        console.error(`未知参数: ${argv[i]}`);
        process.exit(1);
    }
  }
  return opts;
}

export function resolveAppDir(root: string): string {
  if (existsSync(join(root, 'src', 'app'))) return join('src', 'app');
  if (existsSync(join(root, 'app'))) return 'app';
  return join('src', 'app');
}

export function renderRouteFile({ containerPath }: { containerPath: string }): string {
  return `import { createRemHandler } from 'rem-agent-routes';
import type { NextRequest } from 'next/server';
import type { IAgentService } from 'rem-agent-bridge';
import { getContainer } from '${containerPath}';

const handle = createRemHandler({
  getAgentService: async () => (await getContainer()).resolve<IAgentService>('agentService'),
});

async function route(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return handle(req, path);
}

export { route as GET, route as POST, route as PATCH, route as DELETE, route as PUT };
`;
}

export function run(argv: string[]): void {
  const opts = parseArgs(argv);
  const appDir = opts.appDir ?? resolveAppDir(opts.root);
  const dir = join(opts.root, appDir, ...opts.prefix.split('/'), '[...path]');
  const target = join(dir, 'route.ts');

  if (existsSync(target) && !opts.force) {
    console.log(`已存在，跳过（使用 --force 覆盖）: ${target}`);
    return;
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(target, renderRouteFile({ containerPath: opts.containerPath }));
  console.log(`已生成: ${target}`);
}
