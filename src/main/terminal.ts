import * as pty from 'node-pty';
import { userInfo } from 'node:os';
import type { TerminalEvent, TerminalStart } from '../shared/terminal.js';

export class LocalTerminal {
  readonly id: string;
  readonly projectId: string;
  private process: pty.IPty;
  private ended = false;
  private outstanding = 0;
  private exited = false;

  constructor(
    input: TerminalStart,
    root: string,
    emit: (event: TerminalEvent) => void,
  ) {
    this.id = input.id;
    this.projectId = input.projectId;

    const shell =
      process.platform === 'win32'
        ? process.env.COMSPEC || 'cmd.exe'
        : userInfo().shell || '/bin/sh';
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };

    delete env.ELECTRON_RUN_AS_NODE;
    this.process = pty.spawn(
      shell,
      process.platform === 'win32' ? [] : ['-l'],
      {
        name: 'xterm-256color',
        cwd: root,
        env,
        cols: input.cols,
        rows: input.rows,
      },
    );
    this.process.onData((data) => {
      if (this.ended) return;

      this.outstanding += data.length;
      if (this.outstanding > 128 * 1024) this.process.pause();
      emit({ id: this.id, type: 'data', data });
    });
    this.process.onExit(({ exitCode }) => {
      this.exited = true;
      this.ended = true;
      emit({ id: this.id, type: 'exit', code: exitCode });
    });
  }

  write(data: string) {
    if (!this.ended) this.process.write(data);
  }

  resize(cols: number, rows: number) {
    if (!this.ended) this.process.resize(cols, rows);
  }

  acknowledge(size: number) {
    this.outstanding = Math.max(0, this.outstanding - size);
    if (!this.ended && this.outstanding < 32 * 1024) this.process.resume();
  }

  stop() {
    if (this.ended) return;

    this.ended = true;
    try {
      this.process.resume();
      this.process.kill();

      if (process.platform !== 'win32') {
        const timer = setTimeout(() => {
          if (this.exited) return;

          try {
            process.kill(-this.process.pid, 'SIGKILL');
          } catch {
            this.process.kill('SIGKILL');
          }
        }, 1000);

        timer.unref();
      }
    } catch {
      /* Already exited. */
    }
  }
}
