import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs } from 'node:fs/promises';
import os from 'node:os';

const run = promisify(execFile);

async function service(name) {
  try {
    const { stdout } = await run('systemctl', ['show', name,
      '--property=ActiveState,Result,ExecMainStatus,ActiveEnterTimestamp,InactiveEnterTimestamp',
      '--no-pager'], { timeout: 3000 });
    return Object.fromEntries(stdout.trim().split('\n').map(line => {
      const index = line.indexOf('=');
      return [line.slice(0, index), line.slice(index + 1)];
    }));
  } catch { return { ActiveState: 'unknown', Result: 'unavailable' }; }
}

export async function systemHealth({ discord, taskEngine, dataDirectory, version = '4.6.0' }) {
  const [backup, disk] = await Promise.all([
    service('jarvis-backup.service'),
    statfs(dataDirectory).catch(() => null),
  ]);
  const available = disk ? disk.bavail * disk.bsize : null;
  const total = disk ? disk.blocks * disk.bsize : null;
  const memory = process.memoryUsage();
  const uptimeSeconds = Math.round(process.uptime());
  return {
    version,
    checkedAt: new Date().toISOString(),
    process: { healthy: true, uptimeSeconds, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed },
    host: { freeMemoryBytes: os.freemem(), totalMemoryBytes: os.totalmem(), availableDiskBytes: available, totalDiskBytes: total },
    discord: discord.snapshot(),
    backup: {
      result: backup.Result || 'unknown',
      active: backup.ActiveState || 'unknown',
      lastStarted: backup.ActiveEnterTimestamp || '',
      lastFinished: backup.InactiveEnterTimestamp || '',
      exitCode: backup.ExecMainStatus || '',
    },
    tasks: { usage: taskEngine.currentUsage(), failed: taskEngine.list().filter(task => task.status === 'failed').length },
  };
}
