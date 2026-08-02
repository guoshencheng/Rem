import { parseLiveAgentCommandOptions } from '../src/testing/live-agent/command-options.js';
import { runLiveAgent } from '../src/testing/live-agent/run-live-agent.js';

async function main(): Promise<void> {
  const options = parseLiveAgentCommandOptions(process.argv.slice(2));
  const result = await runLiveAgent(options, (line) => process.stdout.write(`${line}\n`));
  process.exitCode = result.exitCode;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
