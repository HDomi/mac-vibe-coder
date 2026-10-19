import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Resolve PATH from the user's login shell. Electron launched from Finder has a minimal PATH. */
export async function syncLoginShellPath(): Promise<string> {
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-lic', 'echo -n "$PATH"'], { timeout: 8000 });
    const p = stdout.trim();
    if (p) process.env.PATH = p;
  } catch {
    /* keep current PATH */
  }
  return process.env.PATH ?? '';
}

export async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-lc', `command -v ${cmd}`], { timeout: 8000 });
    const p = stdout.trim().split('\n').pop() ?? '';
    return p.startsWith('/') ? p : null;
  } catch {
    return null;
  }
}

export async function run(cmd: string, args: string[], timeout = 15000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execFileP(cmd, args, { timeout, env: process.env });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? e.message).trim(), ok: false };
  }
}

/** Run a shell command line in a login shell, streaming output lines. */
export function streamShell(commandLine: string, onLine: (line: string, stream: 'stdout' | 'stderr') => void): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('/bin/zsh', ['-lc', commandLine], { env: process.env });
    const pump = (src: NodeJS.ReadableStream, stream: 'stdout' | 'stderr') => {
      let buf = '';
      src.on('data', (d: Buffer) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? '';
        for (const l of lines) onLine(l, stream);
      });
      src.on('end', () => { if (buf) onLine(buf, stream); });
    };
    pump(child.stdout, 'stdout');
    pump(child.stderr, 'stderr');
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (err) => { onLine(String(err), 'stderr'); resolve(1); });
  });
}
