# Deployment

This repo has two deployable pieces:

- `web/`: Next.js frontend. Deploy this to Vercel.
- root `src/server.js`: Node/Express backend. Deploy this separately to a Node host such as Render, Railway, Fly.io, or a small VPS.

Vercel does not run the long-lived Express server from `run.sh` as a background process for the Next app. The frontend proxies `/api/*` to the backend URL configured with `BACKEND_URL`.

## 1. Backend

Deploy the root app (not `web/`) to a Node host.

Recommended settings:

- Build command: `npm install`
- Start command: `npm start`
- Node version: `20+`
- Health check: `GET /api/health`

Environment variables:

```bash
PORT=8765
USER_AGENT="AltaDriveEstimator/1.0 (your-email@example.com)"
CAMERA_CACHE_MS=120000
NOMINATIM_URL=https://nominatim.openstreetmap.org/search
OSRM_URL=http://router.project-osrm.org/route/v1/driving
COTTONWOOD_ROAD_INFO_URL=https://cottonwoodcanyons.udot.utah.gov/road-information/
UDOT_CCTV_URL_TEMPLATE=https://www.udottraffic.utah.gov/map/Cctv/{id}
NWS_POINTS_URL_TEMPLATE=https://api.weather.gov/points/{lat},{lon}
```

There are no API keys in the current MVP. If you move geocoding/routing to a paid provider, store its token in the backend host's env settings and never commit it.

## 2. Frontend on Vercel

Create a Vercel project from the repo and set:

- Root directory: `web`
- Build command: `npm run build`
- Output: Next.js default

Set this Vercel environment variable:

```bash
BACKEND_URL=https://your-backend-host.example.com
```

Do not use `127.0.0.1` or `localhost` in production; that would point Vercel at itself, not your backend.

## Public Repo Checklist

- Commit `.env.example` and `web/.env.local.example`.
- Do not commit `.env`, `.env.local`, `.venv`, `node_modules`, or `.next`.
- If files were already committed before `.gitignore`, remove them from git tracking with `git rm --cached`.
- Rotate any key that was ever committed, even if it is later deleted.
