import { checkDiffCommand } from "./commands/check-diff";

export interface CliCommand {
  name: string;
  description: string;
  run: (args: string[]) => Promise<number | void>;
}

export const commands: Record<string, CliCommand> = {};

export function registerCommand(cmd: CliCommand): void {
  commands[cmd.name] = cmd;
}

// Minimal additive hook (1-3 lines) to register check-diff in CLI entrypoint
registerCommand(checkDiffCommand);

export async function runCli(argv: string[]): Promise<number> {
  const commandName = argv[0];
  if (!commandName || commandName === "--help" || commandName === "-h") {
    printHelp();
    process.exitCode = 0;
    return 0;
  }

  const command = commands[commandName];
  if (!command) {
    console.error(`Unknown command: ${commandName}`);
    printHelp();
    process.exitCode = 0;
    return 0;
  }

  const subArgs = argv.slice(1);
  const result = await command.run(subArgs);
  const exitCode = typeof result === "number" ? result : 0;
  process.exitCode = exitCode;
  return exitCode;
}

function printHelp(): void {
  console.log(
    "Traceback CLI - Developer advisory checks against engineering decisions\n",
  );
  console.log("Usage: traceback <command> [options]\n");
  console.log("Commands:");
  for (const [name, cmd] of Object.entries(commands)) {
    console.log(`  ${name.padEnd(20)} ${cmd.description}`);
  }
  console.log(
    "\nRun 'traceback <command> --help' for details on a specific command.",
  );
}

export { checkDiffCommand };
