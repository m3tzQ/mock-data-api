'use strict';

const express = require('express');
const cors = require('cors');
let rateLimitLib;
try { rateLimitLib = require('express-rate-limit'); } catch (_) { rateLimitLib = require('express-rate-limit').default; }
const rateLimit = rateLimitLib?.rateLimit || rateLimitLib;
const compression = require('compression');
const { faker } = require('@faker-js/faker');
const Papa = require('papaparse');
const pkg = require('./package.json');

const app = express();

// Trust proxy for correct client IPs behind Railway/Proxies
app.set('trust proxy', 1);

// Globals
const MAX_COUNT = Number.parseInt(process.env.MAX_COUNT || '100', 10);
const DEFAULT_COUNT = 1;
const RATE_LIMIT_PER_HOUR = Number.parseInt(process.env.RATE_LIMIT_PER_HOUR || '1000', 10);
const DISABLE_RATE_LIMIT = /^(1|true|yes|on)$/i.test(String(process.env.DISABLE_RATE_LIMIT || 'false'));
const CORS_ORIGIN = process.env.CORS_ORIGIN;

// Middleware
// Compression
app.use(compression());

// CORS (allow all by default; restrict via env for production)
if (!CORS_ORIGIN || CORS_ORIGIN === '*' || CORS_ORIGIN === 'true') {
  app.use(cors());
} else {
  const allowList = CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({ origin: allowList }));
}

app.use(express.json({ limit: '1mb' }));

// Optional rate limiting (per IP per hour)
if (!DISABLE_RATE_LIMIT && RATE_LIMIT_PER_HOUR > 0) {
  const limiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: RATE_LIMIT_PER_HOUR,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'rate_limit_exceeded',
      detail: 'Too many requests. Please try again later.'
    }
  });
  app.use(limiter);
}

// Utilities
function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function clampCount(rawCount) {
  const parsed = Number.parseInt(String(rawCount ?? DEFAULT_COUNT), 10);
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_COUNT;
  return Math.min(parsed, MAX_COUNT);
}

function applySeed(req) {
  const raw = req.query.seed;
  if (raw === undefined) return;
  const seed = Number.parseInt(String(raw), 10);
  if (!Number.isNaN(seed)) {
    faker.seed(seed);
  }
}

function getDeep(obj, path) {
  const segments = path.split('.');
  let current = obj;
  for (const segment of segments) {
    if (current == null) return undefined;
    current = current[segment];
  }
  return current;
}

function setDeep(target, path, value) {
  const segments = path.split('.');
  let current = target;
  for (let i = 0; i < segments.length; i += 1) {
    const key = segments[i];
    if (i === segments.length - 1) {
      current[key] = value;
    } else {
      current[key] = current[key] ?? {};
      current = current[key];
    }
  }
}

function selectFields(data, fields) {
  if (!fields || fields.length === 0) return data;
  const pickObject = (obj) => {
    const out = {};
    for (const path of fields) {
      const value = getDeep(obj, path);
      if (value !== undefined) setDeep(out, path, value);
    }
    return out;
  };
  if (Array.isArray(data)) return data.map((item) => pickObject(item));
  return pickObject(data);
}

function flattenObject(obj, prefix = '') {
  const result = {};
  const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';
  const pathJoin = (a, b) => (a ? `${a}.${b}` : b);
  for (const [key, value] of Object.entries(obj ?? {})) {
    const full = pathJoin(prefix, key);
    if (isPlainObject(value)) {
      Object.assign(result, flattenObject(value, full));
    } else if (Array.isArray(value)) {
      // Represent arrays as JSON strings for CSV safety
      result[full] = JSON.stringify(value);
    } else {
      result[full] = value;
    }
  }
  return result;
}

function respond(req, res, data) {
  // Optional field selection
  const fieldsParam = req.query.fields ? String(req.query.fields) : '';
  const fields = fieldsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const filtered = fields.length > 0 ? selectFields(data, fields) : data;

  const format = String((req.query.format || 'json')).toLowerCase();
  const flatten = toBoolean(req.query.flatten, false);

  if (format !== 'csv') {
    const payload = flatten
      ? (Array.isArray(filtered) ? filtered.map((o) => flattenObject(o)) : flattenObject(filtered))
      : filtered;
    res.type('application/json');
    return res.status(200).send(payload);
  }

  try {
    const rows = Array.isArray(filtered) ? filtered : [filtered];
    const flattenedRows = rows.map((o) => flattenObject(o));
    const csv = Papa.unparse(flattenedRows, { header: true });
    res.header('Content-Disposition', 'inline; filename="data.csv"');
    res.type('text/csv');
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({ error: 'csv_generation_failed', detail: String(error?.message || error) });
  }
}

function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Atomic field generators registry
const GEN_MAP = {
  // Personal
  firstName: () => faker.person.firstName(),
  lastName: () => faker.person.lastName(),
  fullName: () => faker.person.fullName(),
  username: () => faker.internet.username(),
  password: () => faker.internet.password({ length: 12 }),
  email: () => faker.internet.email(),
  phone: () => faker.phone.number(),
  birthdate: () => faker.date.birthdate({ min: 18, max: 90, mode: 'age' }).toISOString().slice(0, 10),

  // Address
  street: () => faker.location.streetAddress(),
  city: () => faker.location.city(),
  state: () => faker.location.state(),
  postalCode: () => faker.location.zipCode(),
  country: () => faker.location.country(),

  // Business & Work
  companyName: () => faker.company.name(),
  jobTitle: () => faker.person.jobTitle(),
  department: () => faker.commerce.department(),
  taxId: () => faker.helpers.replaceSymbols('##-#######'),
  businessId: () => faker.helpers.replaceSymbols('??-########'),

  // Location
  latitude: () => Number(faker.location.latitude()),
  longitude: () => Number(faker.location.longitude()),

  // Financial
  creditCardNumber: () => faker.finance.creditCardNumber(),
  bankAccountNumber: () => faker.finance.accountNumber({ length: 12 }),
  iban: () => faker.finance.iban(),
  swift: () => faker.finance.bic(),
  ethereumAddress: () => faker.finance.ethereumAddress(),
  bitcoinAddress: () => faker.finance.bitcoinAddress?.() || `bc1${faker.string.alphanumeric({ length: 30 })}`,

  // Product & E‑commerce
  productName: () => faker.commerce.productName(),
  sku: () => faker.string.alphanumeric({ length: 10 }).toUpperCase(),
  category: () => faker.commerce.department(),
  description: () => faker.commerce.productDescription(),
  price: () => Number(faker.commerce.price({ min: 1, max: 1500, dec: 2 })),

  // Internet & Tech
  ipv4: () => faker.internet.ipv4(),
  ipv6: () => faker.internet.ipv6(),
  macAddress: () => faker.internet.mac(),
  url: () => faker.internet.url(),
  uuid: () => faker.string.uuid(),
  lorem: () => faker.lorem.paragraph(),

  // Health (fake)
  patientName: () => faker.person.fullName(),
  medicalRecordNumber: () => faker.helpers.replaceSymbols('MRN-########'),
  icd10Code: () => pickRandom(['A00.0', 'B20', 'E11.9', 'I10', 'J45.909', 'M54.5', 'R51.9', 'Z00.00'])
};

function listFields() {
  return Object.keys(GEN_MAP).sort();
}

function generateByKey(key) {
  const fn = GEN_MAP[key];
  if (!fn) return undefined;
  return fn();
}

function generateFromKeys(keys) {
  const out = {};
  for (const key of keys) {
    const value = generateByKey(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function generateFromMap(map) {
  // map may be { alias: 'key', nested: { lat: 'latitude' } }
  if (typeof map === 'string') {
    return generateByKey(map);
  }
  if (Array.isArray(map)) {
    // array of generator keys
    return map.map((k) => generateFromMap(k));
  }
  if (map && typeof map === 'object') {
    const out = {};
    for (const [alias, spec] of Object.entries(map)) {
      out[alias] = generateFromMap(spec);
    }
    return out;
  }
  return undefined;
}

// Generators
function generateAddress() {
  return {
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    postalCode: faker.location.zipCode(),
    country: faker.location.country()
  };
}

function generateUser() {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const domain = faker.internet.domainName();
  const username = faker.internet.username({ firstName, lastName });

  return {
    id: faker.string.uuid(),
    firstName,
    lastName,
    fullName: faker.person.fullName({ firstName, lastName }),
    email: faker.internet.email({ firstName, lastName, provider: domain }),
    phone: faker.phone.number(),
    address: generateAddress(),
    avatar: faker.image.avatar(),
    username,
    password: faker.internet.password({ length: 12 }),
    birthdate: faker.date.birthdate({ min: 18, max: 90, mode: 'age' }).toISOString().slice(0, 10)
  };
}

function generateCompany() {
  return {
    id: faker.string.uuid(),
    name: faker.company.name(),
    industry: faker.commerce.department(),
    employees: faker.number.int({ min: 1, max: 20000 }),
    address: generateAddress(),
    website: faker.internet.url()
  };
}

function generateProduct() {
  const price = Number(faker.commerce.price({ min: 1, max: 1500, dec: 2 }));
  return {
    id: faker.string.uuid(),
    name: faker.commerce.productName(),
    sku: faker.string.alphanumeric({ length: 10 }).toUpperCase(),
    category: faker.commerce.department(),
    description: faker.commerce.productDescription(),
    price,
    currency: 'USD'
  };
}

function generatePersonal() {
  const user = generateUser();
  return {
    names: {
      first: user.firstName,
      last: user.lastName,
      full: user.fullName
    },
    address: user.address,
    phone: user.phone,
    email: user.email,
    birthdate: user.birthdate,
    credentials: {
      username: user.username,
      password: user.password
    }
  };
}

function generateBusiness() {
  return {
    companyName: faker.company.name(),
    jobTitle: faker.person.jobTitle(),
    department: faker.commerce.department(),
    taxId: faker.helpers.replaceSymbols('##-#######'),
    businessId: faker.helpers.replaceSymbols('??-########')
  };
}

function generateLocation() {
  const lat = Number(faker.location.latitude());
  const lng = Number(faker.location.longitude());
  const routeLength = faker.number.int({ min: 3, max: 8 });
  const route = Array.from({ length: routeLength }, () => ({
    latitude: Number(faker.location.latitude()),
    longitude: Number(faker.location.longitude())
  }));
  return {
    coordinates: { latitude: lat, longitude: lng },
    city: faker.location.city(),
    state: faker.location.state(),
    country: faker.location.country(),
    postalCode: faker.location.zipCode(),
    route
  };
}

function generateFinancial() {
  return {
    creditCardNumber: faker.finance.creditCardNumber(),
    bankAccountNumber: faker.finance.accountNumber({ length: 12 }),
    iban: faker.finance.iban(),
    swift: faker.finance.bic(),
    cryptoAddress: pickRandom([
      faker.finance.ethereumAddress(),
      faker.finance.bitcoinAddress?.() || `bc1${faker.string.alphanumeric({ length: 30 })}`
    ])
  };
}

function generateTech() {
  return {
    ipv4: faker.internet.ipv4(),
    ipv6: faker.internet.ipv6(),
    macAddress: faker.internet.mac(),
    url: faker.internet.url(),
    uuid: faker.string.uuid(),
    lorem: faker.lorem.paragraph()
  };
}

function generateHealth() {
  const exampleIcd10 = pickRandom([
    'A00.0', 'B20', 'E11.9', 'I10', 'J45.909', 'M54.5', 'R51.9', 'Z00.00'
  ]);
  return {
    patientName: faker.person.fullName(),
    medicalRecordNumber: faker.helpers.replaceSymbols('MRN-########'),
    diagnosisCode: exampleIcd10
  };
}

function generateMultiple(factoryFn, count) {
  return Array.from({ length: count }, () => factoryFn());
}

// Supported composite types for /generate and /types
const SUPPORTED_TYPES = {
  user: generateUser,
  company: generateCompany,
  product: generateProduct,
  address: generateAddress,
  personal: generatePersonal,
  business: generateBusiness,
  location: generateLocation,
  financial: generateFinancial,
  tech: generateTech,
  health: generateHealth
};

// Routes
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const html = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Mock Data API</title>
      <style>
        body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Noto Sans, "Apple Color Emoji", "Segoe UI Emoji"; margin: 2rem; line-height: 1.45; }
        code, pre { background: #f6f8fa; padding: 0.2rem 0.4rem; border-radius: 4px; }
        a { color: #2563eb; text-decoration: none; }
        a:hover { text-decoration: underline; }
        h1, h2 { margin-top: 1.2em; }
        ul { margin: 0.5rem 0 1rem 1.2rem; }
      </style>
    </head>
    <body>
      <h1>Mock Data Generator API</h1>
      <p>Instant fake data API. Supports JSON (default) and CSV via <code>?format=csv</code>. Limit: ${MAX_COUNT} items per request. ${(!DISABLE_RATE_LIMIT && RATE_LIMIT_PER_HOUR > 0) ? `Rate limit: ${RATE_LIMIT_PER_HOUR} req/hour per IP.` : 'No rate limit configured.'}</p>
      <p>Version: ${pkg.version}</p>
      <h2>Quickstart</h2>
      <ul>
        <li><a href="${baseUrl}/user">/user</a> – single user</li>
        <li><a href="${baseUrl}/users?count=10">/users?count=10</a> – multiple users</li>
        <li><a href="${baseUrl}/company">/company</a>, <a href="${baseUrl}/product">/product</a>, <a href="${baseUrl}/address">/address</a></li>
        <li><a href="${baseUrl}/generate?type=personal">/generate?type=personal</a> – rich presets (<a href="${baseUrl}/types">/types</a>)</li>
        <li>All support <code>?format=csv</code></li>
      </ul>
      <p>Built for the <a href="https://railway.com/hackathon" target="_blank" rel="noreferrer noopener">Railway Hackathon</a>.</p>
    </body>
  </html>`;
  res.type('html').send(html);
});

// Health check
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    version: pkg.version,
    uptimeSec: Math.round(process.uptime()),
    rateLimitEnabled: !DISABLE_RATE_LIMIT && RATE_LIMIT_PER_HOUR > 0,
    maxCount: MAX_COUNT
  });
});

app.get('/user', (req, res) => {
  applySeed(req);
  return respond(req, res, generateUser());
});

app.get('/users', (req, res) => {
  applySeed(req);
  const count = clampCount(req.query.count);
  return respond(req, res, generateMultiple(generateUser, count));
});

app.get('/company', (req, res) => {
  applySeed(req);
  return respond(req, res, generateCompany());
});

app.get('/product', (req, res) => {
  applySeed(req);
  return respond(req, res, generateProduct());
});

app.get('/address', (req, res) => {
  applySeed(req);
  return respond(req, res, generateAddress());
});

// Composite categories
app.get('/personal', (req, res) => {
  applySeed(req);
  return respond(req, res, generatePersonal());
});

app.get('/business', (req, res) => {
  applySeed(req);
  return respond(req, res, generateBusiness());
});

app.get('/location', (req, res) => {
  applySeed(req);
  return respond(req, res, generateLocation());
});

app.get('/financial', (req, res) => {
  applySeed(req);
  return respond(req, res, generateFinancial());
});

app.get('/tech', (req, res) => {
  applySeed(req);
  return respond(req, res, generateTech());
});

app.get('/health', (req, res) => {
  applySeed(req);
  return respond(req, res, generateHealth());
});

app.get('/types', (req, res) => {
  return res.json({
    types: Object.keys(SUPPORTED_TYPES),
    fields: listFields()
  });
});

// Flexible generator
app.get('/generate', (req, res) => {
  applySeed(req);
  const count = clampCount(req.query.count);

  // Flexible selection:
  // - keys: comma-separated GEN_MAP keys
  // - map: JSON object mapping output shape to generator keys
  // - type: legacy preset types
  const keysParam = req.query.keys ? String(req.query.keys) : '';
  const mapParam = req.query.map ? String(req.query.map) : '';
  const type = String(req.query.type || '').toLowerCase();

  let factory;
  if (keysParam) {
    const keys = keysParam.split(',').map((s) => s.trim()).filter(Boolean);
    factory = () => generateFromKeys(keys);
  } else if (mapParam) {
    let spec;
    try { spec = JSON.parse(mapParam); } catch (_) { return res.status(400).json({ error: 'invalid_map_json' }); }
    factory = () => generateFromMap(spec);
  } else if (type) {
    factory = SUPPORTED_TYPES[type];
  }

  if (!factory) {
    return res.status(400).json({ error: 'invalid_request', detail: 'Provide ?keys=..., ?map=..., or ?type=... (see /types)' });
  }

  const data = count > 1 ? generateMultiple(factory, count) : factory();
  return respond(req, res, data);
});

// Error handler
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

async function start() {
  try {
    const helmetModule = await import('helmet');
    const helmet = helmetModule.default || helmetModule;
    app.use(helmet());
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('helmet not loaded; continuing without extra security headers:', String(error?.message || error));
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Mock Data API v${pkg.version} listening on port ${port}`);
    console.log(`Config: { MAX_COUNT: ${MAX_COUNT}, RATE_LIMIT_PER_HOUR: ${RATE_LIMIT_PER_HOUR}, DISABLE_RATE_LIMIT: ${DISABLE_RATE_LIMIT}, CORS_ORIGIN: ${CORS_ORIGIN || '*'} }`);
  });

  function shutdown(signal) {
    // eslint-disable-next-line no-console
    console.log(`Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
      // eslint-disable-next-line no-console
      console.log('Closed out remaining connections. Bye.');
      process.exit(0);
    });
    // Force exit after 10s
    setTimeout(() => process.exit(1), 10000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();


