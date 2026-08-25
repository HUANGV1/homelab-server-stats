# Homelab Server Stats

A lightweight React dashboard with a local Node/Express API for monitoring the machine it runs on. Useful for testing Tailscale or other remote access setups.

## Features

- CPU load, cores, and speed
- RAM usage
- Disk/storage usage and IO rates
- Network interfaces and traffic
- System uptime and host details

## Requirements

- Node.js 18+
- npm

## Server / Tailscale Setup

For a homelab server, use **production mode** (one port, works over Tailscale):

```bash
git clone https://github.com/HUANGV1/homelab-server-stats.git
cd homelab-server-stats
npm install
npm run serve
```

Then open from any device on your tailnet:

```text
http://<tailscale-ip>:3000
```

Get the Tailscale IP on the server with:

```bash
tailscale ip -4
```

### Why not `npm run dev` on the server?

`npm run dev` runs two processes:
- frontend on port **5173**
- API on port **3000**

That is fine for local testing on the server itself, but for Tailscale remote access, production mode is simpler because everything is served on port 3000.

If you do use dev mode, open `http://localhost:5173` on the server (not port 3000).

## Troubleshooting

**"Could not reach the stats API"**

1. Make sure dependencies are installed:
   ```bash
   npm install
   ```
2. Check whether the API is running:
   ```bash
   curl http://127.0.0.1:3000/api/health
   ```
   You should see `{"ok":true,...}`.
3. If port 3000 is already in use, either stop the other process or run on another port:
   ```bash
   PORT=3001 npm start
   ```
4. For Tailscale access, prefer:
   ```bash
   npm run serve
   ```
   and use port **3000**, not 5173.

**First stats load is slow**

On some Windows/Linux hosts, the first `/api/stats` request can take 15-30 seconds while hardware info is collected. Wait for it once; later refreshes are faster.

## Development

Install dependencies:

```bash
npm install
```

Run the API and Vite dev server together:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:3000/api/stats`

Vite proxies `/api` requests to the backend during development.

## Production

Build the frontend and serve it from Express:

```bash
npm run build
npm start
```

Then open:

```text
http://<server-ip>:3000
```

## Tailscale Access

If the server is on your tailnet, you can reach it from another device with:

```text
http://<tailscale-ip>:3000
```

Find the machine's Tailscale IP with `tailscale ip -4` on the server.

## Security Note

This app has no authentication and exposes host metrics. Keep it on trusted networks only, such as your LAN or Tailscale tailnet.

## API

- `GET /api/health` - health check
- `GET /api/stats` - current machine stats JSON payload

