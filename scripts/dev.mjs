// Runs the API (:3001) and the Vite dev server (:5173) together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev', '-w', '@wd/api']],
  ['web', ['run', 'dev', '-w', '@wd/web']],
].map(([name, args]) => {
  const child = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const prefix = (line) => `[${name}] ${line}`;
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) console.log(prefix(line));
    });
  }
  child.on('exit', (code) => {
    console.log(prefix(`exited with code ${code}`));
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
