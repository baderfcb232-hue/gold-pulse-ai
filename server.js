// Keep the existing Render start command: node server.js.
if (Number(process.versions.node.split('.')[0]) < 24) {
  throw new Error('NABD requires Node.js 24. Set NODE_VERSION=24.21.0 in Render or use the repository .node-version.');
}
const {startServer} = await import('./server.mjs');
startServer();
