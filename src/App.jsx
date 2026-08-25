import { useCallback, useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 30000;

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(1)}%`;
}

function formatSpeed(value) {
  if (value == null || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(2)} GHz`;
}

function ProgressBar({ value, label, detail }) {
  const percent = value == null ? 0 : Math.min(Math.max(value, 0), 100);
  const tone =
    percent >= 90 ? 'critical' : percent >= 75 ? 'warning' : 'healthy';

  return (
    <div className="progress-block">
      <div className="progress-header">
        <span>{label}</span>
        <span>{detail ?? formatPercent(value)}</span>
      </div>
      <div className="progress-track">
        <div className={`progress-fill ${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function StatCard({ title, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MetricRow({ label, value }) {
  return (
    <div className="metric-row">
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value ?? 'N/A'}</span>
    </div>
  );
}

function App() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchStats = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('/api/stats', { signal: controller.signal });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.message || data.error || `Request failed with status ${response.status}`
        );
      }

      setStats(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (fetchError) {
      const message =
        fetchError.name === 'AbortError'
          ? 'Stats request timed out. The backend may be stuck collecting metrics.'
          : fetchError.message;
      setError(message);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const intervalId = setInterval(fetchStats, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [fetchStats]);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Homelab Monitor</p>
          <h1>{stats?.hostname ?? 'Server Stats'}</h1>
          <p className="subtitle">
            {stats?.platform ?? 'Collecting system information...'}
          </p>
        </div>
        <div className="hero-meta">
          <div className="status-pill">
            <span className={`status-dot ${error ? 'offline' : 'online'}`} />
            {error ? 'Disconnected' : loading && !stats ? 'Connecting' : 'Live'}
          </div>
          <p className="updated-at">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()}`
              : 'Waiting for first update'}
          </p>
        </div>
      </header>

      {error && (
        <div className="alert">
          Could not reach the stats API: {error}. Make sure the backend is running on port 3000.
          {window.location.port === '5173'
            ? ' If you are on the server machine, run "npm run dev" and check the server terminal for errors.'
            : ' For remote access over Tailscale, use "npm run serve" and open port 3000 instead of 5173.'}
        </div>
      )}

      {loading && !stats ? (
        <div className="loading">Loading server stats...</div>
      ) : (
        <main className="dashboard-grid">
          <StatCard title="CPU">
            <MetricRow label="Processor" value={stats?.cpu?.brand} />
            <MetricRow
              label="Cores"
              value={
                stats?.cpu
                  ? `${stats.cpu.physicalCores} physical / ${stats.cpu.cores} logical`
                  : 'N/A'
              }
            />
            <MetricRow label="Speed" value={formatSpeed(stats?.cpu?.speedGHz)} />
            <ProgressBar
              label="Overall Load"
              value={stats?.cpu?.loadPercent}
              detail={formatPercent(stats?.cpu?.loadPercent)}
            />
            {stats?.cpu?.perCoreLoad?.length > 0 && (
              <div className="core-grid">
                {stats.cpu.perCoreLoad.map((core) => (
                  <div key={core.core} className="core-chip">
                    <span>Core {core.core}</span>
                    <strong>{formatPercent(core.loadPercent)}</strong>
                  </div>
                ))}
              </div>
            )}
          </StatCard>

          <StatCard title="Memory">
            <ProgressBar
              label="RAM Usage"
              value={stats?.memory?.usedPercent}
              detail={`${stats?.memory?.usedFormatted ?? 'N/A'} / ${stats?.memory?.totalFormatted ?? 'N/A'}`}
            />
            <MetricRow label="Available" value={stats?.memory?.availableFormatted} />
            <MetricRow label="Active" value={formatBytes(stats?.memory?.active)} />
          </StatCard>

          <StatCard title="Storage">
            {stats?.storage?.length ? (
              stats.storage.map((disk) => (
                <div key={disk.mount} className="storage-item">
                  <div className="storage-header">
                    <strong>{disk.mount}</strong>
                    <span>{disk.fs}</span>
                  </div>
                  <ProgressBar
                    label={disk.type || 'Disk'}
                    value={disk.usePercent}
                    detail={`${disk.usedFormatted} / ${disk.sizeFormatted}`}
                  />
                  <MetricRow
                    label="Read / Write"
                    value={
                      disk.readBytesPerSec != null || disk.writeBytesPerSec != null
                        ? `${formatBytes(disk.readBytesPerSec)}/s · ${formatBytes(disk.writeBytesPerSec)}/s`
                        : 'N/A'
                    }
                  />
                </div>
              ))
            ) : (
              <p className="muted">No storage data available.</p>
            )}
          </StatCard>

          <StatCard title="Network & Uptime" className="wide">
            <MetricRow label="Uptime" value={stats?.uptime?.formatted} />
            <MetricRow label="System" value={`${stats?.system?.manufacturer ?? ''} ${stats?.system?.model ?? ''}`.trim() || 'N/A'} />
            {stats?.network?.interfaces?.length ? (
              <div className="network-list">
                {stats.network.interfaces.map((iface) => (
                  <div key={iface.iface} className="network-item">
                    <strong>{iface.iface}</strong>
                    <span>{iface.ip4 || iface.ip6 || 'No IP'}</span>
                    <span>{iface.speedMbps ? `${iface.speedMbps} Mbps` : iface.type}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No active network interfaces found.</p>
            )}
            {stats?.network?.stats?.length > 0 && (
              <div className="network-stats">
                {stats.network.stats.map((entry) => (
                  <MetricRow
                    key={entry.iface}
                    label={`${entry.iface} traffic`}
                    value={`↓ ${entry.rxFormatted} · ↑ ${entry.txFormatted}`}
                  />
                ))}
              </div>
            )}
          </StatCard>
        </main>
      )}
    </div>
  );
}

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

export default App;
