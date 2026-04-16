// oxlint-disable e18e/prefer-static-regex
import {readFileSync} from 'node:fs';

const external = [
  'node:*',
  '@badrap/valita',
  '@rocicorp/datadog-util',
  '@rocicorp/lock',
  '@rocicorp/logger',
  '@rocicorp/resolver',
  'replicache',
];

export function sharedOptions(
  minify: boolean | undefined = true,
  metafile: boolean | undefined = false,
) {
  const opts = {
    bundle: true,
    target: 'es2022',
    format: 'esm',
    external,
    minify,
    sourcemap: true,
    metafile,
  } as const;
  if (minify) {
    return /** @type {const} */ {
      ...opts,
      mangleProps: /^_./,
      reserveProps: /^__.*__$/,
    } as const;
  }
  return opts;
}

function getAppPackageJSON() {
  const url = new URL('../../../apps/zbugs/package.json', import.meta.url);
  const s = readFileSync(url, 'utf-8');
  return JSON.parse(s) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

function getDependencyVersion(name: string): string {
  const pkg = getAppPackageJSON();
  const version = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (!version) {
    return 'unknown';
  }
  return version;
}

export function makeDefine(
  mode: 'debug' | 'release' | 'unknown' = 'unknown',
): Record<string, string> {
  /** @type {Record<string, string>} */
  const define: Record<string, string> = {
    ['process.env.REPLICACHE_VERSION']: JSON.stringify(
      getDependencyVersion('replicache'),
    ),
    ['process.env.ZERO_VERSION']: JSON.stringify(
      getDependencyVersion('@rocicorp/zero'),
    ),
    ['process.env.DISABLE_MUTATION_RECOVERY']: 'false',
    ['TESTING']: 'false',
  };
  if (mode === 'unknown') {
    return define;
  }
  return {
    ...define,
    'process.env.NODE_ENV': mode === 'debug' ? '"development"' : '"production"',
  };
}
