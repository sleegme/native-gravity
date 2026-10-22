import { createInterface } from 'node:readline';

createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') {
    if (process.argv.includes('--reject-init')) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id,
        error: { code: -32603, message: 'fixture initialization failure' } })}\n`);
      return;
    }
    result = { protocolVersion: '2024-11-05', capabilities: { tools: {} },
      serverInfo: { name: 'fixture-not-windows', version: '0' } };
  } else if (request.method === 'tools/list') {
    result = { tools: ['Snapshot', 'Screenshot', 'PowerShell', 'FileSystem', 'App'].map(name => ({
      name, inputSchema: { type: 'object', properties: {} },
    })) };
  } else if (request.method === 'tools/call') {
    if (request.params.name === 'PowerShell') process.exit(77);
    result = { content: [{ type: 'text', text: 'PRIVATE_DESKTOP_SENTINEL' },
      { type: 'image', mimeType: 'image/png', data: 'PRIVATE_IMAGE_SENTINEL' }] };
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
