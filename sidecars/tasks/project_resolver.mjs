import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { getConversationWorkspaces } from './host_api.mjs';
export { getConversationWorkspaces } from './host_api.mjs';


export function projectsFileCandidates(deps = {}) {
  const home = deps.homedir ? deps.homedir() : homedir();
  return [
    join(home, '.config', 'beads-tasks', 'projects.json'),
    ...(deps.extraProjectsFiles || []),
  ];
}

/**
 * Resolves the multi-project config file.
 * Priority: explicit path, configured environment keys, then existing defaults.
 */
export function resolveProjectsFile(deps = {}) {
  if (deps.projectsFile) return deps.projectsFile;
  for (const key of ['BEADS_TASKS_PROJECTS_FILE', ...(deps.extraProjectsEnvKeys || [])]) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return resolve(value.trim());
  }
  return defaultPaths(deps).projectsFile;
}

export function defaultPaths(deps = {}) {
  const fsExists = deps.existsSync || existsSync;
  const candidates = projectsFileCandidates(deps);
  return {
    projectsFile: candidates.find((p) => fsExists(p)) || candidates[0],
    projectsFileCandidates: candidates,
  };
}

export function loadProjectsConfig(projectsFile = defaultPaths().projectsFile, fsApi = { existsSync, readFileSync }, deps = {}) {
  try {
    if (!fsApi.existsSync(projectsFile)) {
      return { activeProject: '', projects: [] };
    }
    const raw = JSON.parse(fsApi.readFileSync(projectsFile, 'utf8'));
    const projects = Array.isArray(raw?.projects)
      ? raw.projects.filter((p) => p && typeof p === 'object' && (p.id || p.name)).map((p) => normalizeProject(p, deps))
      : [];
    return {
      activeProject: typeof raw?.activeProject === 'string' ? raw.activeProject.trim() : '',
      projects,
    };
  } catch {
    return { activeProject: '', projects: [] };
  }
}

export function normalizeProject(p, deps = {}) {
  const repo = typeof p.repo === 'string' && p.repo.trim() ? resolve(p.repo.trim()) : '';
  const id = String(p.id || p.name || repo || 'default').trim();
  const name = String(p.name || p.id || (repo ? basename(repo) : 'Project')).trim();
  const project = {
    id,
    name,
    repo,
    bdDir: typeof p.bdDir === 'string' && p.bdDir.trim() ? resolve(p.bdDir.trim()) : (repo ? join(repo, '.beads') : ''),
    machine: typeof p.machine === 'string' ? p.machine.trim() : '',
    env: typeof p.env === 'string' ? p.env.trim() : '',
  };
  return deps.extendProject ? deps.extendProject(project, p) : project;
}

export function deriveProjectFromRepo(repoPath, deps = {}) {
  const abs = resolve(String(repoPath || '').trim());
  const name = basename(abs) || abs;
  const project = {
    id: `repo:${abs}`,
    name,
    repo: abs,
    bdDir: join(abs, '.beads'),
    machine: '',
    env: '',
    derived: true,
  };
  return deps.extendProject ? deps.extendProject(project, {}) : project;
}

function fsApiFor(deps = {}) {
  const api = deps.fsApi || {};
  return {
    existsSync: api.existsSync || deps.existsSync || existsSync,
    readFileSync: api.readFileSync || deps.readFileSync || readFileSync,
  };
}

/** Reads `project_id` from a Beads `metadata.json`, tolerating missing/broken files. */
function readBeadsProjectId(metadataPath, deps = {}) {
  if (!metadataPath) return '';
  const fs = fsApiFor(deps);
  try {
    if (!fs.existsSync(metadataPath)) return '';
    const raw = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const id = raw?.project_id;
    return typeof id === 'string' ? id.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Walks from `targetPath` up to (excluding) `parentRepo` looking for a nested
 * directory with its own independent `.beads/` root.
 * Returns that directory, or '' when the target belongs to the parent repo
 * (plain subdirectory, or a worktree sharing the same `project_id`, or a
 * `.beads/redirect` worktree marker).
 */
export function findNestedBeadsRepo(targetPath, parentRepo, parentBdDir = '', deps = {}) {
  if (!targetPath || !parentRepo) return '';
  const abs = resolve(targetPath);
  const parent = resolve(parentRepo);
  if (!abs.startsWith(parent + '/')) return '';
  const fs = fsApiFor(deps);
  const parentProjectId = readBeadsProjectId(parentBdDir ? join(parentBdDir, 'metadata.json') : '', deps);

  let dir = abs;
  while (dir.startsWith(parent + '/') && dir !== parent) {
    const bdDir = join(dir, '.beads');
    if (fs.existsSync(bdDir) && !fs.existsSync(join(bdDir, 'redirect'))) {
      const nestedProjectId = readBeadsProjectId(join(bdDir, 'metadata.json'), deps);
      const sameProject = Boolean(nestedProjectId && parentProjectId && nestedProjectId === parentProjectId);
      if (!sameProject) return dir;
    }
    const next = dirname(dir);
    if (next === dir) break;
    dir = next;
  }
  return '';
}

/**
 * Matches a path against configured projects.
 * Returns `{ project, nestedRoot }`: `project` for an exact repo match or a
 * subdirectory/worktree of a configured repo, `nestedRoot` when a nested
 * independent `.beads` repo shadows the configured parent (then `project` is null).
 */
function matchByRepoPath(projects, targetPath, deps = {}) {
  if (!targetPath) return null;
  const abs = resolve(targetPath);
  const exact = projects.find((p) => p.repo && p.repo === abs);
  if (exact) return { project: exact, nestedRoot: '' };
  // Also match if targetPath is inside a configured repo (e.g. a worktree or subdirectory)
  let best = null;
  for (const p of projects) {
    if (!p.repo || !abs.startsWith(p.repo + '/')) continue;
    if (!best || p.repo.length > best.repo.length) best = p;
  }
  if (!best) return null;
  const nestedRoot = findNestedBeadsRepo(abs, best.repo, best.bdDir, deps);
  if (nestedRoot) return { project: null, nestedRoot };
  return { project: best, nestedRoot: '' };
}

export async function resolveProjectContext(params = {}, deps = {}) {
  const projectsFile = resolveProjectsFile(deps);
  const cfg = loadProjectsConfig(projectsFile, deps.fsApi, deps);
  const reqProject = typeof params.project === 'string' ? params.project.trim() : '';
  const reqRepo = typeof params.repo === 'string' ? params.repo.trim() : '';
  const convId = typeof params.conversationId === 'string' ? params.conversationId.trim() : '';

  // 1. Explicit project id/name
  if (reqProject) {
    const matched = cfg.projects.find((p) => p.id === reqProject || p.name === reqProject);
    if (matched) {
      return { ...matched, source: 'param:project' };
    }
  }

  // 2. Explicit repo path
  if (reqRepo) {
    const matched = matchByRepoPath(cfg.projects, reqRepo, deps);
    if (matched?.project) {
      return { ...matched.project, source: 'param:repo' };
    }
    return { ...deriveProjectFromRepo(matched?.nestedRoot || reqRepo, deps), source: 'param:repo-derived' };
  }

  // 3. Active conversation workspace from the host
  if (convId) {
    const wsPaths = await (deps.resolveWorkspaces || getConversationWorkspaces)(convId, deps);
    for (const ws of wsPaths) {
      const matched = matchByRepoPath(cfg.projects, ws, deps);
      if (matched?.project) {
        return { ...matched.project, source: 'conversation' };
      }
      if (matched?.nestedRoot) {
        return { ...deriveProjectFromRepo(matched.nestedRoot, deps), source: 'conversation-derived' };
      }
    }
    if (wsPaths.length > 0) {
      return { ...deriveProjectFromRepo(wsPaths[0], deps), source: 'conversation-derived' };
    }
  }

  // 4. Configured activeProject
  if (cfg.activeProject) {
    const active = cfg.projects.find((p) => p.id === cfg.activeProject);
    if (active) {
      return { ...active, source: 'activeProject' };
    }
  }

  // 5. First configured project
  if (cfg.projects.length > 0) {
    return { ...cfg.projects[0], source: 'firstConfigured' };
  }

  return null;
}

export async function listKnownProjects(params = {}, deps = {}) {
  const projectsFile = resolveProjectsFile(deps);
  const cfg = loadProjectsConfig(projectsFile, deps.fsApi, deps);
  const resolved = await resolveProjectContext(params, deps);
  const list = [...cfg.projects];
  if (resolved && !list.some((p) => p.id === resolved.id || (p.repo && resolved.repo && p.repo === resolved.repo))) {
    list.unshift(resolved);
  }
  return {
    activeProjectId: resolved?.id || cfg.activeProject || '',
    projects: list,
  };
}
