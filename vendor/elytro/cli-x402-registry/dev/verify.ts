// npx --yes tsx ./dev/verify.ts 

declare function require(name: string): any;
declare const process: {
    cwd: () => string;
    exitCode?: number;
};

const fs = require('fs').promises;
const path = require('path');

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


function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function validatePricing(pricing: unknown, pointer: string, errors: string[]): pricing is Pricing {
    if (!isRecord(pricing)) {
        errors.push(`${pointer} must be an object`);
        return false;
    }

    if (pricing.type !== 'free' && pricing.type !== 'fixed' && pricing.type !== 'dynamic') {
        errors.push(`${pointer}.type must be one of: free | fixed | dynamic`);
        return false;
    }

    if (pricing.type === 'fixed') {
        if (typeof pricing.amount !== 'string' || pricing.amount.length === 0) {
            errors.push(`${pointer}.amount must be a non-empty string when pricing.type is fixed`);
        }
        if (typeof pricing.per !== 'string' || pricing.per.length === 0) {
            errors.push(`${pointer}.per must be a non-empty string when pricing.type is fixed`);
        }
    }

    if (pricing.description !== undefined && typeof pricing.description !== 'string') {
        errors.push(`${pointer}.description must be a string when present`);
    }

    if (pricing.note !== undefined && typeof pricing.note !== 'string') {
        errors.push(`${pointer}.note must be a string when present`);
    }

    return true;
}

function validateEndpoint(endpoint: unknown, pointer: string, errors: string[]): endpoint is Endpoint {
    if (!isRecord(endpoint)) {
        errors.push(`${pointer} must be an object`);
        return false;
    }

    if (typeof endpoint.method !== 'string' || endpoint.method.length === 0) {
        errors.push(`${pointer}.method must be a non-empty string`);
    }
    if (typeof endpoint.path !== 'string' || endpoint.path.length === 0) {
        errors.push(`${pointer}.path must be a non-empty string`);
    }
    if (typeof endpoint.description !== 'string' || endpoint.description.length === 0) {
        errors.push(`${pointer}.description must be a non-empty string`);
    }

    validatePricing(endpoint.pricing, `${pointer}.pricing`, errors);

    if (endpoint.note !== undefined && typeof endpoint.note !== 'string') {
        errors.push(`${pointer}.note must be a string when present`);
    }
    if (endpoint.docs !== undefined && typeof endpoint.docs !== 'string') {
        errors.push(`${pointer}.docs must be a string when present`);
    }

    return true;
}

function validateServiceBase(
    service: unknown,
    pointer: string,
    errors: string[]
): service is Service {
    if (!isRecord(service)) {
        errors.push(`${pointer} must be an object`);
        return false;
    }

    if (typeof service.id !== 'string' || service.id.length === 0) {
        errors.push(`${pointer}.id must be a non-empty string`);
    }
    if (typeof service.name !== 'string' || service.name.length === 0) {
        errors.push(`${pointer}.name must be a non-empty string`);
    }
    if (typeof service.description !== 'string' || service.description.length === 0) {
        errors.push(`${pointer}.description must be a non-empty string`);
    }
    if (!isStringArray(service.categories)) {
        errors.push(`${pointer}.categories must be an array of strings`);
    }
    if (typeof service.serviceUrl !== 'string' || service.serviceUrl.length === 0) {
        errors.push(`${pointer}.serviceUrl must be a non-empty string`);
    }
    if (!isStringArray(service.tags)) {
        errors.push(`${pointer}.tags must be an array of strings`);
    }

    return true;
}

function validateServiceDetail(service: unknown, pointer: string, errors: string[]): service is ServiceDetail {
    validateServiceBase(service, pointer, errors);

    if (!isRecord(service)) {
        return false;
    }

    if (!isStringArray(service.docs)) {
        errors.push(`${pointer}.docs must be an array of strings`);
    }

    if (!Object.prototype.hasOwnProperty.call(service, 'endpoints')) {
        errors.push(`${pointer}.endpoints is required for non-index service files`);
    } else {
        if (!Array.isArray(service.endpoints)) {
            errors.push(`${pointer}.endpoints must be an array`);
        } else {
            service.endpoints.forEach((endpoint, index) => {
                validateEndpoint(endpoint, `${pointer}.endpoints[${index}]`, errors);
            });
        }
    }

    return true;
}

async function loadJson(filePath: string): Promise<unknown> {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as unknown;
}

async function validateIndexJson(filePath: string, errors: string[]): Promise<void> {
    const json = await loadJson(filePath);

    if (!isRecord(json)) {
        errors.push(`index.json root must be an object`);
        return;
    }

    if (!Array.isArray(json.services)) {
        errors.push(`index.json.services must be an array`);
        return;
    }

    json.services.forEach((service, index) => {
        validateServiceBase(service, `index.json.services[${index}]`, errors);
    });
}

async function validateServiceJson(filePath: string, fileName: string, errors: string[]): Promise<void> {
    const json = await loadJson(filePath);
    validateServiceDetail(json, fileName, errors);
}


async function main() {
    const repoRoot = process.cwd();
    const entries: Array<{ isFile: () => boolean; name: string }> = await fs.readdir(repoRoot, {
        withFileTypes: true,
    });
    const ignoredJsonFiles = new Set(['package-lock.json']);
    const jsonFiles = entries
        .filter(
            (entry: { isFile: () => boolean; name: string }) =>
                entry.isFile() && entry.name.endsWith('.json') && !ignoredJsonFiles.has(entry.name)
        )
        .map((entry: { isFile: () => boolean; name: string }) => entry.name)
        .sort();

    if (jsonFiles.length === 0) {
        console.error('No .json files found in repository root.');
        process.exitCode = 1;
        return;
    }

    const errors: string[] = [];

    for (const fileName of jsonFiles) {
        const filePath = path.join(repoRoot, fileName);

        try {
            if (fileName === 'index.json') {
                await validateIndexJson(filePath, errors);
            } else {
                await validateServiceJson(filePath, fileName, errors);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${fileName}: ${message}`);
        }
    }

    if (errors.length > 0) {
        console.error(`Validation failed with ${errors.length} issue(s):`);
        for (const error of errors) {
            console.error(`- ${error}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log(`Validation passed: ${jsonFiles.length} JSON file(s) checked.`);
}


main();
