import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSidecarApp } from './app_factory.mjs';

const { run } = createSidecarApp({
  defaultTitle: 'Beads Tasks',
  uiConfig: { title: 'Beads Tasks', storageKey: 'beads-tasks-review-queue' },
});
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) run();
