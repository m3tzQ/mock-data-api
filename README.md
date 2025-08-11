# Mock Data Generator API

Spin up an instantly deployable mock data API. Choose exactly which fields to generate or use presets. JSON by default, CSV via `?format=csv`. One‑click deploy on Railway.

[![Deploy on Railway](https://railway.app/button.svg)]([https://railway.app/template/new?name=Mock%20Data%20API&description=Instant%20mock%20data%20API%20powered%20by%20Express%20%2B%20Faker%2E&repo=&plugins=&envs=PORT&PORTDefault=3000](https://railway.com/deploy/instant-mock-data-api))

## Features
- Fine‑grained field generation: pick exactly the fields you want via `keys` or custom JSON `map`
- Preset endpoints for quick start: `/user`, `/company`, `/product`, etc.
- Formats: JSON and CSV (`?format=csv`), with `?flatten=true` to flatten nested objects for CSV
- Deterministic via `?seed=...`
- Response shaping: `?fields=...` to include only certain response fields
- High limits with safeguards: `MAX_COUNT` per request; optional rate limiting per IP/hour
- CORS enabled and gzip compression on by default

## Endpoints

- `/` – HTML docs
- `/healthz` – health check
- `/user` – single fake user
- `/users?count=10` – multiple users
- `/company` – single fake company
- `/product` – single fake product
- `/address` – single fake address
- `/generate` – flexible generator (see below)
- `/types` – lists preset `types` and atomic `fields`

All endpoints support:
- `?format=csv`
- `?seed=123` for deterministic results
- `?fields=fieldA,fieldB` to select output fields
- `?flatten=true` to flatten nested objects before returning/CSV

### Flexible generation (`/generate`)
Pick one of the three ways below to specify what to generate. You can combine with `count`, `format`, `flatten`, `seed`, and `fields`.

1) Keys (choose fields from the atomic set)

```
GET /generate?keys=firstName,lastName,email&count=3
```

2) Map (build a custom JSON shape)

```
GET /generate?map={"id":"uuid","name":{"first":"firstName","last":"lastName"},"loc":{"lat":"latitude","lng":"longitude"}}&count=2
```

Tip: URL‑encode the JSON map in shells/browsers:

```
GET /generate?map=%7B%22id%22%3A%22uuid%22%2C%22name%22%3A%7B%22first%22%3A%22firstName%22%2C%22last%22%3A%22lastName%22%7D%2C%22loc%22%3A%7B%22lat%22%3A%22latitude%22%2C%22lng%22%3A%22longitude%22%7D%7D
```

3) Preset type (legacy presets still supported)

```
GET /generate?type=user&count=5
```

List available atomic fields and preset types:

```
GET /types
```

### Preset types
- `user`, `company`, `product`, `address`
- `personal`, `business`, `location`, `financial`, `tech`, `health`

## Query parameters
- `count` (number): how many items to generate. Max default is `MAX_COUNT`.
- `format` (string): `json` (default) or `csv`.
- `flatten` (boolean): flatten nested objects. Helpful for CSV.
- `seed` (number): seed Faker for deterministic output.
- `fields` (comma list): filter output fields after generation.
- `keys` (comma list): choose atomic generator fields (for `/generate`).
- `map` (JSON): specify a custom object shape mapping to atomic fields.
- `type` (string): use one of the preset types (for `/generate`).

## Examples

Only specific fields:
```
GET /generate?keys=firstName,lastName,phone,email
```

Custom shape and CSV:
```
GET /generate?map=%7B%22id%22%3A%22uuid%22%2C%22email%22%3A%22email%22%2C%22geo%22%3A%7B%22lat%22%3A%22latitude%22%2C%22lng%22%3A%22longitude%22%7D%7D&count=10&format=csv&flatten=true
```

Deterministic data:
```
GET /generate?keys=firstName,lastName,email&seed=42
```

## Environment variables
These can be set in Railway or locally before `npm run dev`.

- `PORT` (default: 3000): server port
- `DISABLE_RATE_LIMIT` (default: true in `railway.json`): disable per‑IP rate limiting
- `RATE_LIMIT_PER_HOUR` (default: 1000): when enabled, requests per IP per hour
- `MAX_COUNT` (default: 100): max items per request
- `CORS_ORIGIN` (default: `*`): comma‑separated list of allowed origins; `*` allows all

## Local development

```bash
cd mock-data-api
npm install
npm run dev
# open http://localhost:3000
```

## Deploy to Railway
1. Push this folder (`mock-data-api/`) to a public GitHub repo
2. On Railway: New Project → Deploy from GitHub → select your repo
3. Confirm variables (defaults are pre-configured via `railway.json`)
4. Once deployed, open the URL and test `/healthz` and `/generate`

### Make it a public Railway Template
1. Open your Railway project → Settings → Template → Create Template
2. Expose env vars (`PORT`, `DISABLE_RATE_LIMIT`, `RATE_LIMIT_PER_HOUR`, `MAX_COUNT`, `CORS_ORIGIN`)
3. Publish and share the “Deploy on Railway” button

No API keys are required.
