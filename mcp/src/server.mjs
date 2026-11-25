import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startTasksMcpServer } from './server_factory.mjs';
export { capStructuredPayload } from './server_factory.mjs';

export const options = {
  name: 'beads-tasks', version: '0.1.0', uri: 'ui://beads-tasks/app.html',
  boardTitle: 'Beads Tasks', appHtmlEnvKey: 'BEADS_TASKS_MCP_APP_HTML',
};
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await startTasksMcpServer(options);
