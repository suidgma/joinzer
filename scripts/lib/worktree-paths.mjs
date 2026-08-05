/**
 * Path facts a worktree bootstrap/teardown needs, separated from the CLI that acts on them.
 *
 * These three functions are the whole reason `bootstrap-worktree.mjs` can be trusted, and each one
 * exists because its absence already cost something:
 *
 *   classify()             — existsSync cannot tell a junction from a real directory. The branch
 *                            that only asked "does it exist" skipped an existing `metro-research`
 *                            without checking what it was, which is how metro-wave-1 ended up
 *                            holding five metros' research as a real directory: the only copy,
 *                            invisible to the backup, reachable by `git clean -fdx`.
 *   countEntries()         — the before/after proof across a worktree removal. A junction that
 *                            looked unlinked but was not shows up as a drop in the shared target's
 *                            entry count, and nothing else would reveal it.
 *   unresolvedConfigPaths()— a fresh worktree carries only TRACKED files, so a config whose input
 *                            is a gitignored directory inside the repo (little-rock-count/) resolves
 *                            in the main checkout and ENOENTs here, mid-run.
 *
 * Kept dependency-free and side-effect-free on import so the CLI and the tests share one
 * implementation — the shape `revalidate-directory.mjs` established.
 */
import { lstatSync, readlinkSync, readdirSync, readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'

/**
 * What is actually at a path: 'missing' | 'junction' | 'dir' | 'file'.
 *
 * A Windows junction reports isSymbolicLink() === true to lstat, and readlinkSync returns its
 * target — so both halves of "is this a link, and does it point where I expect" are answerable.
 * `target` is absolute and present only for junctions (null if the link is unreadable).
 */
export const classify = (path) => {
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return { kind: 'missing' }
  }
  if (stats.isSymbolicLink()) {
    try {
      return { kind: 'junction', target: resolve(readlinkSync(path)) }
    } catch {
      return { kind: 'junction', target: null }
    }
  }
  return { kind: stats.isDirectory() ? 'dir' : 'file' }
}

/** Entry count for a directory, or null if it cannot be read. Never throws. */
export const countEntries = (path) => {
  try {
    return readdirSync(path).length
  } catch {
    return null
  }
}

/**
 * Every path a metro config declares that does NOT resolve under `root`.
 *
 * Checks `input` (the artifact) and the DIRECTORY of `geocode_cache` — the flush needs the directory
 * to exist, not the file. Returns a Map keyed by the declared relative path so one missing directory
 * shared by many configs reports once, with the configs that named it.
 */
export const unresolvedConfigPaths = ({ configDir, root, exists = existsSync }) => {
  const unresolved = new Map()
  let configs = []
  try {
    configs = readdirSync(configDir).filter((f) => f.endsWith('.json'))
  } catch {
    return { configCount: 0, unresolved }
  }

  for (const file of configs) {
    let config
    try {
      config = JSON.parse(readFileSync(join(configDir, file), 'utf8'))
    } catch (err) {
      unresolved.set(`${file} (unparseable)`, { files: [file], note: err.message.split('\n')[0] })
      continue
    }
    const declared = [config.input, config.geocode_cache && dirname(config.geocode_cache)].filter(Boolean)
    for (const rel of declared) {
      if (exists(resolve(root, rel))) continue
      if (!unresolved.has(rel)) unresolved.set(rel, { files: [] })
      unresolved.get(rel).files.push(file)
    }
  }

  return { configCount: configs.length, unresolved }
}
