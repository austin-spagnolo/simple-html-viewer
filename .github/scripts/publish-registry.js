'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const OPEN_VSX_API = 'https://open-vsx.org/api';
const OPEN_VSX_LOOKUP_TIMEOUT_MS = 10_000;

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
}

function resolveVsix(vsixPath) {
  const resolvedPath = path.resolve(requiredString(vsixPath, 'VSIX path'));

  let stat;
  try {
    stat = fs.statSync(resolvedPath);
  } catch (error) {
    throw new Error(
      `VSIX file does not exist or cannot be read: ${resolvedPath}`,
      { cause: error },
    );
  }

  if (!stat.isFile()) {
    throw new Error(`VSIX path is not a file: ${resolvedPath}`);
  }

  return resolvedPath;
}

function localBinary(name) {
  const binary = path.join(REPOSITORY_ROOT, 'node_modules', '.bin', name);
  if (!fs.existsSync(binary)) {
    throw new Error(
      `The pinned local ${name} binary is missing. Run npm ci before publishing.`,
    );
  }
  return binary;
}

function redact(value, token) {
  const text = String(value || '');
  return token ? text.split(token).join('[REDACTED]') : text;
}

function runProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
}

async function invokePublisher({
  binary,
  args,
  token,
  tokenVariable,
  run = runProcess,
}) {
  const env = { ...process.env, [tokenVariable]: token };
  let result;
  try {
    result = await run(binary, args, { cwd: REPOSITORY_ROOT, env });
  } catch (error) {
    throw new Error(
      `Publisher command could not run: ${redact(error.message, token)}`,
      { cause: error },
    );
  }
  const stdout = redact(result && result.stdout, token);
  const stderr = redact(result && result.stderr, token);

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const code = result && (result.code ?? result.status);
  if (code !== 0) {
    const detail =
      stderr.trim() ||
      (result && result.signal
        ? `terminated by ${result.signal}`
        : `exit code ${code}`);
    throw new Error(`Publisher command failed: ${detail}`);
  }

  return `${stdout}\n${stderr}`;
}

function matchesIdentity(payload, publisher, name, version) {
  const namespace = payload && (payload.namespace ?? payload.publisher);
  const extensionName = payload && (payload.name ?? payload.extensionName);
  return (
    namespace === publisher &&
    extensionName === name &&
    payload.version === version
  );
}

async function lookupOpenVsx({
  publisher,
  name,
  version,
  fetchImpl = globalThis.fetch,
  timeoutMs = OPEN_VSX_LOOKUP_TIMEOUT_MS,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error(
      'OpenVSX lookup requires a Fetch-compatible implementation.',
    );
  }

  const url = `${OPEN_VSX_API}/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      const reason = controller.signal.aborted
        ? `timed out after ${timeoutMs} ms`
        : error.message;
      throw new Error(`OpenVSX version lookup failed: ${reason}`, {
        cause: error,
      });
    }

    if (response.status === 404) return false;
    if (!response.ok) {
      throw new Error(
        `OpenVSX version lookup failed with HTTP ${response.status}.`,
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('OpenVSX version lookup returned invalid JSON.', {
        cause: error,
      });
    }

    if (!matchesIdentity(payload, publisher, name, version)) {
      throw new Error(
        `OpenVSX returned an unexpected extension identity or version for ${publisher}.${name}@${version}.`,
      );
    }

    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function publishMarketplace({
  vsixPath,
  publisher,
  name,
  version,
  token,
  run,
}) {
  publisher = requiredString(publisher, 'RELEASE_PUBLISHER');
  name = requiredString(name, 'RELEASE_NAME');
  version = requiredString(version, 'RELEASE_VERSION');
  token = requiredString(token, 'VSCE_PAT');
  const packagePath = resolveVsix(vsixPath);
  const commandOutput = await invokePublisher({
    binary: localBinary('vsce'),
    args: ['publish', '--packagePath', packagePath, '--skip-duplicate'],
    token,
    tokenVariable: 'VSCE_PAT',
    run,
  });

  if (
    /already published|already exists.*skip|skipping publish/i.test(
      commandOutput,
    )
  ) {
    console.log(
      `Marketplace ${publisher}.${name}@${version} already published; skipping.`,
    );
    return { status: 'already-published' };
  }

  console.log(
    `Published ${publisher}.${name}@${version} to the VS Code Marketplace.`,
  );
  return { status: 'published' };
}

async function publishOpenVsx({
  vsixPath,
  publisher,
  name,
  version,
  token,
  fetchImpl,
  timeoutMs,
  run,
}) {
  publisher = requiredString(publisher, 'RELEASE_PUBLISHER');
  name = requiredString(name, 'RELEASE_NAME');
  version = requiredString(version, 'RELEASE_VERSION');
  token = requiredString(token, 'OVSX_PAT');
  const packagePath = resolveVsix(vsixPath);

  if (await lookupOpenVsx({ publisher, name, version, fetchImpl, timeoutMs })) {
    console.log(
      `OpenVSX ${publisher}.${name}@${version} already published; skipping.`,
    );
    return { status: 'already-published' };
  }

  const commandOutput = await invokePublisher({
    binary: localBinary('ovsx'),
    args: ['publish', packagePath, '--skip-duplicate'],
    token,
    tokenVariable: 'OVSX_PAT',
    run,
  });

  if (
    /already published|already exists.*skip|skipping publish/i.test(
      commandOutput,
    )
  ) {
    console.log(
      `OpenVSX ${publisher}.${name}@${version} already published; skipping.`,
    );
    return { status: 'already-published' };
  }

  console.log(`Published ${publisher}.${name}@${version} to OpenVSX.`);
  return { status: 'published' };
}

async function publishRegistry(registry, vsixPath, options = {}) {
  const common = { ...options, vsixPath };
  if (registry === 'marketplace') return publishMarketplace(common);
  if (registry === 'openvsx') return publishOpenVsx(common);
  throw new Error(
    `Unsupported registry "${registry}". Expected marketplace or openvsx.`,
  );
}

async function main(
  argv = process.argv.slice(2),
  env = process.env,
  deps = {},
) {
  const [registry, vsixPath, ...extra] = argv;
  if (!registry || !vsixPath || extra.length) {
    throw new Error(
      'Usage: node .github/scripts/publish-registry.js marketplace|openvsx <vsix-path>',
    );
  }

  const options = {
    publisher: env.RELEASE_PUBLISHER,
    name: env.RELEASE_NAME,
    version: env.RELEASE_VERSION,
    token: registry === 'marketplace' ? env.VSCE_PAT : env.OVSX_PAT,
    ...deps,
  };
  return publishRegistry(registry, vsixPath, options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  lookupOpenVsx,
  main,
  publishMarketplace,
  publishOpenVsx,
  publishRegistry,
};
