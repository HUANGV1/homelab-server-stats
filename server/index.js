import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import si from 'systeminformation';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const distPath = path.join(__dirname, '..', 'dist');
const serveFrontend = fs.existsSync(distPath);
const METRIC_TIMEOUT_MS = Number(process.env.METRIC_TIMEOUT_MS || 15000);
const STATS_REFRESH_INTERVAL_MS = Number(process.env.STATS_REFRESH_INTERVAL_MS || 10000);

let statsCache = null;
let statsError = null;
let statsRefreshing = false;
const optionalProbes = {
  temperature: { enabled: true, reason: null },
  gpu: { enabled: true, reason: null },
};

function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatUptime(seconds) {
  if (seconds == null) return 'N/A';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function safeNumber(value, fallback = null) {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function withMetricTimeout(label, promise, fallback) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`${label} probe timed out after ${METRIC_TIMEOUT_MS}ms`);
          resolve(fallback);
        }, METRIC_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.warn(`${label} probe failed: ${error.message}`);
    return fallback;
  } finally {
    clearTimeout(timeoutId);
  }
}

function pickPrimaryGpu(gpus) {
  if (!Array.isArray(gpus) || gpus.length === 0) return null;
  return gpus.find((gpu) => gpu.type === 'NVIDIA' || gpu.type === 'AMD') || gpus[0];
}

function disableOptionalProbe(name, reason) {
  if (!optionalProbes[name]?.enabled) return;
  optionalProbes[name] = { enabled: false, reason };
  console.warn(`${name} probe disabled: ${reason}`);
}

function hasTemperatureData(temps) {
  return (
    safeNumber(temps?.main) != null ||
    safeNumber(temps?.max) != null ||
    summarizeTemperatures(temps).length > 0
  );
}

function hasGpuData(graphics) {
  return asArray(graphics?.controllers).some((controller) => {
    return controller?.model || controller?.vendor || controller?.name;
  });
}

function summarizeTemperatures(temps) {
  if (temps?.main == null || typeof temps.main !== 'object') return [];
  return Object.entries(temps.main)
    .filter(([, value]) => typeof value === 'number')
    .map(([label, value]) => ({ label, value }));
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

function createUnavailableStats(message = 'Stats are still warming up') {
  return {
    timestamp: new Date().toISOString(),
    hostname: 'Unknown Host',
    platform: process.platform,
    status: 'warming',
    message,
    uptime: {
      seconds: null,
      formatted: 'N/A',
    },
    cpu: {
      manufacturer: null,
      brand: 'Collecting...',
      cores: null,
      physicalCores: null,
      speedGHz: null,
      loadPercent: null,
      perCoreLoad: [],
    },
    memory: {
      total: null,
      used: null,
      free: null,
      active: null,
      available: null,
      usedPercent: null,
      totalFormatted: 'N/A',
      usedFormatted: 'N/A',
      availableFormatted: 'N/A',
    },
    storage: [],
    temperatures: {
      main: null,
      max: null,
      sensors: [],
    },
    gpu: null,
    optionalProbes,
    network: {
      interfaces: [],
      stats: [],
    },
    system: {
      manufacturer: null,
      model: null,
      version: null,
      serial: null,
    },
  };
}

async function collectStats() {
  try {
    const startedAt = Date.now();
    const cpu = await withMetricTimeout('cpu', si.cpu(), {});
    const currentLoad = await withMetricTimeout('cpu load', si.currentLoad(), {
      currentLoad: null,
      avgLoad: null,
      cpus: [],
    });
    let cpuTemp = { main: null, cores: [], max: null };
    if (optionalProbes.temperature.enabled) {
      cpuTemp = await withMetricTimeout('temperature', si.cpuTemperature(), cpuTemp);
      if (!hasTemperatureData(cpuTemp)) {
        disableOptionalProbe('temperature', 'no temperature sensors returned data');
      }
    }
    const mem = await withMetricTimeout('memory', si.mem(), {});
    const fsSize = await withMetricTimeout('storage', si.fsSize(), []);
    const fsStats = await withMetricTimeout('storage stats', si.fsStats(), []);
    let graphics = { controllers: [], displays: [] };
    if (optionalProbes.gpu.enabled) {
      graphics = await withMetricTimeout('graphics', si.graphics(), graphics);
      if (!hasGpuData(graphics)) {
        disableOptionalProbe('gpu', 'no GPU controllers returned data');
      }
    }
    const networkInterfaces = await withMetricTimeout(
      'network interfaces',
      si.networkInterfaces(),
      []
    );
    const networkStats = await withMetricTimeout('network stats', si.networkStats(), []);
    const time = await withMetricTimeout('time', si.time(), {});
    const osInfo = await withMetricTimeout('os info', si.osInfo(), {});
    const system = await withMetricTimeout('system info', si.system(), {});

    const disks = asArray(fsSize);
    const diskStats = asArray(fsStats);
    const interfaces = asArray(networkInterfaces);
    const traffic = asArray(networkStats);
    const primaryGpu = pickPrimaryGpu(graphics.controllers);
    const activeInterfaces = interfaces.filter(
      (iface) => iface.operstate === 'up' && !iface.internal && iface.ip4
    );

    const stats = {
      timestamp: new Date().toISOString(),
      hostname: osInfo.hostname || 'Unknown Host',
      platform: `${osInfo.distro || osInfo.platform} ${osInfo.release || ''}`.trim(),
      uptime: {
        seconds: safeNumber(time.uptime),
        formatted: formatUptime(time.uptime),
      },
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speedGHz: safeNumber(cpu.speed),
        loadPercent: safeNumber(currentLoad.currentLoad),
        perCoreLoad: (currentLoad.cpus || []).map((core, index) => ({
          core: index,
          loadPercent: safeNumber(core.load),
        })),
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        active: mem.active,
        available: mem.available,
        usedPercent: mem.total ? (mem.used / mem.total) * 100 : null,
        totalFormatted: formatBytes(mem.total),
        usedFormatted: formatBytes(mem.used),
        availableFormatted: formatBytes(mem.available),
      },
      storage: disks.map((disk) => {
        const statsForMount = diskStats.find(
          (entry) => entry.fs === disk.fs || entry.mount === disk.mount
        );
        return {
          fs: disk.fs,
          type: disk.type,
          mount: disk.mount,
          size: disk.size,
          used: disk.used,
          available: disk.available,
          usePercent: disk.use,
          sizeFormatted: formatBytes(disk.size),
          usedFormatted: formatBytes(disk.used),
          availableFormatted: formatBytes(disk.available),
          readBytesPerSec: safeNumber(statsForMount?.rx_sec),
          writeBytesPerSec: safeNumber(statsForMount?.wx_sec),
        };
      }),
      temperatures: {
        main: safeNumber(cpuTemp.main),
        max: safeNumber(cpuTemp.max),
        sensors: summarizeTemperatures(cpuTemp),
      },
      gpu: primaryGpu
        ? {
            vendor: primaryGpu.vendor,
            model: primaryGpu.model,
            vram: primaryGpu.vram,
            vramDynamic: primaryGpu.vramDynamic,
            driverVersion: primaryGpu.driverVersion,
            temperatureGpu: safeNumber(primaryGpu.temperatureGpu),
            utilizationGpu: safeNumber(primaryGpu.utilizationGpu),
            utilizationMemory: safeNumber(primaryGpu.utilizationMemory),
            memoryTotal: primaryGpu.memoryTotal,
            memoryUsed: primaryGpu.memoryUsed,
            memoryFree: primaryGpu.memoryFree,
          }
        : null,
      optionalProbes,
      network: {
        interfaces: activeInterfaces.map((iface) => ({
          iface: iface.iface,
          ip4: iface.ip4,
          ip6: iface.ip6,
          mac: iface.mac,
          speedMbps: iface.speed,
          type: iface.type,
        })),
        stats: traffic
          .filter((entry) => entry.operstate === 'up')
          .map((entry) => ({
            iface: entry.iface,
            rxBytesPerSec: safeNumber(entry.rx_sec),
            txBytesPerSec: safeNumber(entry.tx_sec),
            rxFormatted: `${formatBytes(entry.rx_sec)}/s`,
            txFormatted: `${formatBytes(entry.tx_sec)}/s`,
          })),
      },
      system: {
        manufacturer: system.manufacturer,
        model: system.model,
        version: system.version,
        serial: system.serial,
      },
    };

    statsCache = {
      ...stats,
      status: 'ready',
      refreshDurationMs: Date.now() - startedAt,
    };
    statsError = null;
  } catch (error) {
    console.error('Failed to collect stats:', error);
    statsError = error;
    if (!statsCache) {
      statsCache = createUnavailableStats(error.message);
    }
  }
}

async function refreshStats() {
  if (statsRefreshing) return;
  statsRefreshing = true;
  try {
    await collectStats();
  } finally {
    statsRefreshing = false;
  }
}

app.get('/api/stats', (_req, res) => {
  if (!statsCache && !statsRefreshing) {
    void refreshStats();
  }

  res.json({
    ...(statsCache || createUnavailableStats()),
    lastError: statsError?.message || null,
    refreshing: statsRefreshing,
    refreshIntervalMs: STATS_REFRESH_INTERVAL_MS,
  });
});

void refreshStats();
setInterval(() => {
  void refreshStats();
}, STATS_REFRESH_INTERVAL_MS);

if (serveFrontend) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send(
      [
        'Server stats API is running.',
        '',
        'Dev mode: run "npm run dev" and open http://localhost:5173',
        'Production: run "npm run serve" and open http://<server-ip>:3000',
      ].join('\n')
    );
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server stats API listening on http://0.0.0.0:${PORT}`);
  if (!serveFrontend) {
    console.log('No build found: run Vite separately on http://localhost:5173');
  }
});
