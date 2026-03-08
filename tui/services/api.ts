/**
 * Local API service for testing endpoints
 */

export interface ApiResponse {
  status: number;
  data: unknown;
  responseTime: number;
  error?: string;
}

export interface RequestLog {
  id: string;
  timestamp: Date;
  method: string;
  path: string;
  status: number;
  responseTime: number;
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
}

const DEFAULT_BASE_URL = 'http://localhost:8000';

let requestCounter = 0;
const requestLogs: RequestLog[] = [];
const MAX_LOGS = 100;

export function getBaseUrl(): string {
  return process.env.API_URL || DEFAULT_BASE_URL;
}

export async function testEndpoint(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Promise<ApiResponse> {
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}${path}`;
  const startTime = Date.now();

  const requestId = `req_${++requestCounter}_${Date.now()}`;

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const responseTime = Date.now() - startTime;
    let data: unknown;

    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Log the request
    const log: RequestLog = {
      id: requestId,
      timestamp: new Date(),
      method,
      path,
      status: response.status,
      responseTime,
      requestBody: body,
      responseBody: data,
    };
    addRequestLog(log);

    return {
      status: response.status,
      data,
      responseTime,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log the failed request
    const log: RequestLog = {
      id: requestId,
      timestamp: new Date(),
      method,
      path,
      status: 0,
      responseTime,
      requestBody: body,
      error: errorMessage,
    };
    addRequestLog(log);

    return {
      status: 0,
      data: null,
      responseTime,
      error: errorMessage,
    };
  }
}

function addRequestLog(log: RequestLog): void {
  requestLogs.unshift(log);
  if (requestLogs.length > MAX_LOGS) {
    requestLogs.pop();
  }
}

export function getRequestLogs(): RequestLog[] {
  return [...requestLogs];
}

export function clearRequestLogs(): void {
  requestLogs.length = 0;
}

// Predefined endpoint tests
export const ENDPOINTS = {
  health: { method: 'GET', path: '/health', description: 'Health check' },
  tools: { method: 'GET', path: '/tools', description: 'Agent tools discovery' },
  wallets: { method: 'GET', path: '/wallets', description: 'Default user wallets' },
  portfolio: { method: 'GET', path: '/portfolio', description: 'Default user portfolio' },
  authMe: { method: 'GET', path: '/auth/me', description: 'Current user auth' },
  swaps: { method: 'GET', path: '/users/1/swaps?limit=10', description: 'Recent swaps' },
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;

export async function testPredefinedEndpoint(key: EndpointKey): Promise<ApiResponse> {
  const endpoint = ENDPOINTS[key];
  return testEndpoint(endpoint.method, endpoint.path);
}

// Health check with continuous monitoring
export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'unreachable';
  database: string;
  responseTime: number;
  lastCheck: Date;
}

export async function checkHealth(): Promise<HealthStatus> {
  const result = await testEndpoint('GET', '/health');

  if (result.error || result.status === 0) {
    return {
      status: 'unreachable',
      database: 'unknown',
      responseTime: result.responseTime,
      lastCheck: new Date(),
    };
  }

  const data = result.data as { status?: string; database?: string } | null;

  return {
    status: result.status === 200 ? 'healthy' : 'unhealthy',
    database: data?.database || 'unknown',
    responseTime: result.responseTime,
    lastCheck: new Date(),
  };
}
