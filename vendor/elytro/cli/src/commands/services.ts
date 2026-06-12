import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import {
  commandText,
  highlight,
  linkText,
  muted,
  outputError,
  outputResult,
} from '../utils/display';
import { SERVICE_REGISTRY_API } from '../constants/serviceRegistry';

// ─── Safety helpers ──────────────────────────────────────────────────

/** Strip ANSI escape sequences and C0/C1 control characters (except \n) from untrusted strings. */
function sanitize(input: string): string {
  // 1. Remove ANSI escape sequences (CSI, OSC, and simple ESC sequences)
  // 2. Remove remaining C0 control chars (\x00-\x1F except \n) and DEL (\x7F)
  return input
    .replace(/\x1B(?:\[[0-9;]*[A-Za-z]|\][^\x07]*\x07|[^[\]])/g, '')
    .replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
}

/** Validate a service ID: alphanumeric, hyphens, and underscores only. */
const VALID_SERVICE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

/** Default timeout in milliseconds for registry HTTP requests. */
const FETCH_TIMEOUT_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────

interface Pricing {
  type: 'free' | 'fixed' | 'dynamic';
  amount?: string; // present when type='fixed', e.g. "2.000000"
  per?: string; // unit label for fixed, e.g. "charge", "request"
  description?: string; // label for dynamic, e.g. "dynamic charge"
}

interface Endpoint {
  method: string;
  path: string;
  description: string;
  pricing: Pricing;
  note?: string; // extra info shown below description, e.g. "per request"
  docs?: string; // link to endpoint-specific documentation
}

interface Service {
  id: string;
  name: string;
  description: string;
  categories: string[];
  serviceUrl: string;
  tags: string[];
}

interface ServiceDetail extends Service {
  docs: string[];
  endpoints: Endpoint[];
}

// ─── API ──────────────────────────────────────────────────────────────

const BASE = SERVICE_REGISTRY_API.endsWith('/') ? SERVICE_REGISTRY_API : `${SERVICE_REGISTRY_API}/`;

async function fetchServices(): Promise<Service[]> {
  const res = await fetch(`${BASE}index.json`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Registry returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { services: Service[] };
  if (!Array.isArray(data.services)) {
    throw new Error('Unexpected response format from registry');
  }
  return data.services;
}

async function fetchService(id: string): Promise<ServiceDetail> {
  if (!VALID_SERVICE_ID.test(id)) {
    throw new Error(
      `Invalid service ID "${sanitize(id)}". IDs may only contain letters, digits, hyphens, and underscores.`,
    );
  }
  const res = await fetch(`${BASE}${id}.json`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (res.status === 404) {
    throw new Error(
      `Service "${id}" not found. Run 'elytro services' to see all available services.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Registry returned HTTP ${res.status}`);
  }
  return (await res.json()) as ServiceDetail;
}

// ─── Formatting helpers ────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function formatPricing(pricing: Pricing): string {
  switch (pricing.type) {
    case 'free':
      return chalk.green('free');
    case 'fixed': {
      const amount = pricing.amount ? sanitize(pricing.amount) : undefined;
      const per = sanitize(pricing.per ?? 'charge');
      if (!amount) {
        return chalk.yellow(`fixed price per ${per}`);
      }
      return chalk.yellow(`$${amount} ${per}`);
    }
    case 'dynamic':
      return chalk.magenta(sanitize(pricing.description ?? 'dynamic charge'));
  }
}

function formatMethod(method: string): string {
  const padded = method.padStart(METHOD_COL);
  switch (method.toUpperCase()) {
    case 'GET':
      return chalk.green(padded);
    case 'POST':
      return chalk.cyan(padded);
    case 'PUT':
    case 'PATCH':
      return chalk.yellow(padded);
    case 'DELETE':
      return chalk.red(padded);
    default:
      return chalk.blue(padded);
  }
}

// ─── Display: list view ───────────────────────────────────────────────

const COL = { id: 22, name: 24, category: 18 };

function printList(services: Service[]): void {
  const header =
    'ID'.padEnd(COL.id) +
    '  ' +
    'Name'.padEnd(COL.name) +
    '  ' +
    'Category'.padEnd(COL.category) +
    '  ' +
    'Service URL';

  console.log();
  console.log('  ' + chalk.bold(header));
  console.log('  ' + chalk.gray('─'.repeat(header.length)));

  for (const svc of services) {
    const row =
      chalk.cyan(sanitize(svc.id).padEnd(COL.id)) +
      '  ' +
      chalk.bold(truncate(sanitize(svc.name), COL.name).padEnd(COL.name)) +
      '  ' +
      chalk.yellow(
        truncate(svc.categories.map(sanitize).join(', '), COL.category).padEnd(COL.category),
      ) +
      '  ' +
      linkText(sanitize(svc.serviceUrl));
    console.log('  ' + row);
  }

  console.log();
  console.log(
    `  ${muted(`${services.length} service(s). Run`)} ${commandText('elytro services <id>')} ${muted('for details.')}`,
  );
  console.log();
}

// ─── Display: detail view ─────────────────────────────────────────────

const LABEL_WIDTH = 14; // "Service URL" is 11 chars; 14 gives consistent right-alignment
const METHOD_COL = 7; // right-aligns up to "DELETE" (6 chars)
const PATH_COL = 42; // path column width before pricing label

function field(key: string, value: string): void {
  console.log(`  ${muted(key.padStart(LABEL_WIDTH) + ':')} ${value}`);
}

function buildExample(method: string, serviceUrl: string, path: string): string {
  const parts = ['elytro request'];
  if (method !== 'GET') parts.push(`--method ${method}`);
  if (method !== 'GET') parts.push(`--json '{}'`);
  parts.push(serviceUrl + path);
  return parts.join(' ');
}

function printDetail(svc: ServiceDetail): void {
  const name = sanitize(svc.name);
  const description = sanitize(svc.description);
  const id = sanitize(svc.id);
  const serviceUrl = sanitize(svc.serviceUrl);
  const categories = svc.categories.map(sanitize).join(', ');
  const tags = svc.tags.map(sanitize).join(', ');

  console.log();
  console.log(highlight(name));
  console.log(muted('─'.repeat(name.length + 2)));
  console.log(description);
  console.log();

  field('ID', chalk.cyan(id));
  field('Categories', chalk.yellow(categories));
  field('Service URL', linkText(serviceUrl));
  field('Tags', tags);

  const docs = Array.isArray(svc.docs) ? svc.docs : [];
  if (docs.length > 0) {
    console.log();
    console.log(highlight('Docs:'));
    for (const url of docs) {
      console.log(`  ${linkText(sanitize(url))}`);
    }
  }

  const endpoints = Array.isArray(svc.endpoints) ? svc.endpoints : [];
  if (endpoints.length > 0) {
    console.log();
    console.log(highlight('Endpoints:'));
    const indent = '  ' + ' '.repeat(METHOD_COL + 1);
    for (const ep of endpoints) {
      const method = sanitize(ep.method);
      const path = sanitize(ep.path);
      const epDesc = sanitize(ep.description);
      console.log(
        `  ${formatMethod(method)} ${chalk.white(path.padEnd(PATH_COL))}  ${formatPricing(ep.pricing)}`,
      );
      console.log(`${indent}${muted(epDesc)}`);
      if (ep.note) {
        console.log(`${indent}${muted(sanitize(ep.note))}`);
      }
      console.log(
        `${indent}${muted('example:')} ${commandText(buildExample(method, serviceUrl, path))}`,
      );
      if (ep.docs) {
        console.log(`${indent}${muted('docs:')}    ${linkText(sanitize(ep.docs))}`);
      }
    }
  }

  console.log();
}

// ─── Structured (JSON) output ─────────────────────────────────────────

function outputServiceList(services: Service[]): void {
  outputResult({
    services: services.map((svc) => ({
      id: svc.id,
      name: svc.name,
      categories: svc.categories,
      serviceUrl: svc.serviceUrl,
      description: svc.description,
    })),
  });
}

function outputServiceDetail(svc: ServiceDetail): void {
  outputResult({
    id: svc.id,
    name: svc.name,
    description: svc.description,
    categories: svc.categories,
    serviceUrl: svc.serviceUrl,
    tags: svc.tags,
    docs: svc.docs,
    endpoints: (Array.isArray(svc.endpoints) ? svc.endpoints : []).map((ep) => ({
      method: ep.method,
      path: ep.path,
      description: ep.description,
      pricing: ep.pricing,
      ...(ep.note ? { note: ep.note } : {}),
      ...(ep.docs ? { docs: ep.docs } : {}),
      example: buildExample(ep.method, svc.serviceUrl, ep.path),
    })),
  });
}

// ─── Command registration ─────────────────────────────────────────────

export function registerServicesCommand(program: Command): void {
  program
    .command('services')
    .description('Browse Elytro-verified x402-compatible services')
    .argument('[id]', 'Service ID for detailed information')
    .option('--json', 'Output structured JSON instead of human-readable text')
    .action(async (id?: string, options?: { json?: boolean }) => {
      // Use JSON output when --json is passed or stdout is not a TTY (e.g. pipes, MCP callers)
      const useJson = options?.json || !process.stdout.isTTY;

      const spinner = ora(id ? `Fetching service info…` : 'Fetching service catalog…').start();
      try {
        if (id) {
          const svc = await fetchService(id);
          spinner.stop();
          useJson ? outputServiceDetail(svc) : printDetail(svc);
        } else {
          const services = await fetchServices();
          spinner.stop();
          useJson ? outputServiceList(services) : printList(services);
        }
      } catch (err) {
        const messageBase = id
          ? 'Failed to fetch service details.'
          : 'Failed to fetch service catalog.';
        spinner.fail(messageBase);
        const isTimeout = err instanceof DOMException && err.name === 'TimeoutError';
        const detail = isTimeout
          ? `Request timed out after ${FETCH_TIMEOUT_MS / 1000}s. Check your network connection or try again.`
          : (err as Error).message;
        outputError(-32000, detail);
      }
    });
}
