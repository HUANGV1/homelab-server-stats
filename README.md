# Homelab Server Stats

A lightweight React dashboard with a local Node/Express API for monitoring the machine it runs on. Useful for testing Tailscale or other remote access setups.

## Features

- CPU load, cores, and speed
- RAM usage
- Disk/storage usage and IO rates
- CPU/GPU temperatures when exposed by the host
- GPU info and utilization when available
- Network interfaces and traffic
- System uptime and host details

## Requirements

- Node.js 18+
- npm

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

## Notes

- GPU and temperature data depend on OS, drivers, and hardware support.
- Some Windows hosts expose limited sensor data compared to Linux.
