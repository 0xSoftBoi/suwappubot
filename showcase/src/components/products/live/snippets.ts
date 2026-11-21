/** Request snippets for what a widget just ran. The key is always an env var, never the real value. */
export function curlSnippet(method: string, path: string, body?: unknown): string {
  const url = `https://api.suwappu.bot${path}`;
  const lines = [`curl -s ${method === 'GET' ? '' : `-X ${method} `}${url} \\`, `  -H "Authorization: Bearer $SUWAPPU_API_KEY"`];
  if (body !== undefined) lines[lines.length - 1] += ' \\', lines.push(`  -H "Content-Type: application/json" \\`, `  -d '${JSON.stringify(body).replace(/'/g, `'\\''`)}'`);
  return lines.join('\n');
}
export function tsSnippet(method: string, path: string, body?: unknown): string {
  const init = [`  method: '${method}',`, `  headers: {`, `    Authorization: \`Bearer \${process.env.SUWAPPU_API_KEY}\`,`, ...(body !== undefined ? [`    'Content-Type': 'application/json',`] : []), `  },`, ...(body !== undefined ? [`  body: JSON.stringify(${JSON.stringify(body, null, 2).replace(/\n/g, '\n  ')}),`] : [])];
  return `const res = await fetch('https://api.suwappu.bot${path}', {\n${init.join('\n')}\n});\nconsole.log(res.status, await res.json());`;
}
export function pySnippet(method: string, path: string, body?: unknown): string {
  const args = [`    "https://api.suwappu.bot${path}",`, `    headers={"Authorization": f"Bearer {os.environ['SUWAPPU_API_KEY']}"},`, ...(body !== undefined ? [`    json=${JSON.stringify(body, null, 4).replace(/\n/g, '\n    ').replace(/: true/g, ': True').replace(/: false/g, ': False')},`] : [])];
  return `import os, requests\n\nres = requests.${method.toLowerCase()}(\n${args.join('\n')}\n)\nprint(res.status_code, res.json())`;
}
