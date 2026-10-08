'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishMarketplace, publishOpenVsx } = require('./publish-registry');

let artifact;
let fixtureDir;

test.before(() => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-registry-test-'));
  const vsixPath = path.join(fixtureDir, 'simple-html-viewer-1.2.3.vsix');
  fs.writeFileSync(vsixPath, 'test package');
  artifact = {
    vsixPath,
    publisher: 'sample-publisher',
    name: 'simple-html-viewer',
    version: '1.2.3',
  };
});

test.after(() => {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

function callRecorder(result = { code: 0 }) {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return result;
  };
  return { calls, run };
}

test('Open VSX skips publishing when the exact version is already present', async () => {
  const calls = callRecorder();
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url: String(url), init });
    return response(200, {
      namespace: artifact.publisher,
      name: artifact.name,
      version: artifact.version,
    });
  };

  await publishOpenVsx({
    ...artifact,
    token: 'open-vsx-secret',
    fetchImpl,
    run: calls.run,
  });

  assert.equal(requests.length, 1, 'the registry is checked once');
  assert.match(
    requests[0].url,
    /\/sample-publisher\/simple-html-viewer\/1\.2\.3$/,
  );
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(calls.calls.length, 0, 'an existing version is not republished');
});

test('Open VSX publishes the local VSIX when the version lookup returns 404', async () => {
  const calls = callRecorder();
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return response(404, {});
  };

  await publishOpenVsx({
    ...artifact,
    token: 'open-vsx-secret',
    fetchImpl,
    run: calls.run,
  });

  assert.equal(requestCount, 1);
  assert.equal(
    calls.calls.length,
    1,
    'the absent version is published exactly once',
  );
  const { args, options } = calls.calls[0];
  assert.ok(
    args.includes(path.resolve(artifact.vsixPath)),
    'the prepared local VSIX is published',
  );
  assert.ok(
    !args.includes('open-vsx-secret'),
    'the token is not passed as a command argument',
  );
  assert.ok(!JSON.stringify(args).includes('open-vsx-secret'));
  assert.ok(
    JSON.stringify(options).includes('open-vsx-secret'),
    'the credential is supplied through the child environment',
  );
});

test('Open VSX skips a duplicate that appears after the 404 lookup', async () => {
  const calls = callRecorder({
    code: 0,
    stdout: 'Version already published by another release job; skipping.',
  });
  const fetchImpl = async () => response(404, {});

  const result = await publishOpenVsx({
    ...artifact,
    token: 'open-vsx-secret',
    fetchImpl,
    run: calls.run,
  });

  assert.deepEqual(result, { status: 'already-published' });
  assert.equal(
    calls.calls.length,
    1,
    'the publish race is resolved by the registry CLI',
  );
});

test('Open VSX treats authorization and server errors as failures, not as an absent version', async (t) => {
  for (const status of [401, 403, 500, 503]) {
    await t.test(`HTTP ${status}`, async () => {
      const calls = callRecorder();
      const fetchImpl = async () =>
        response(status, { message: 'registry unavailable' });

      await assert.rejects(
        publishOpenVsx({
          ...artifact,
          token: 'open-vsx-secret',
          fetchImpl,
          run: calls.run,
        }),
      );
      assert.equal(
        calls.calls.length,
        0,
        'a failed lookup must not trigger a publish',
      );
    });
  }
});

test('Open VSX propagates network failures instead of treating them as absence', async () => {
  const calls = callRecorder();
  const fetchImpl = async () => {
    throw new Error('connection reset');
  };

  await assert.rejects(
    publishOpenVsx({
      ...artifact,
      token: 'open-vsx-secret',
      fetchImpl,
      run: calls.run,
    }),
  );
  assert.equal(calls.calls.length, 0);
});

test('Open VSX aborts a timed-out lookup without attempting to publish', async () => {
  const calls = callRecorder();
  let observedSignal;
  const fetchImpl = async (_url, { signal }) => {
    observedSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), {
        once: true,
      });
    });
  };

  await assert.rejects(
    publishOpenVsx({
      ...artifact,
      token: 'open-vsx-secret',
      fetchImpl,
      timeoutMs: 5,
      run: calls.run,
    }),
    /timed out/i,
  );
  assert.equal(observedSignal.aborted, true);
  assert.equal(calls.calls.length, 0);
});

test('Open VSX rejects malformed JSON without attempting to publish', async () => {
  const calls = callRecorder();
  const fetchImpl = async () => ({
    status: 200,
    ok: true,
    json: async () => {
      throw new SyntaxError('unexpected token');
    },
  });

  await assert.rejects(
    publishOpenVsx({
      ...artifact,
      token: 'open-vsx-secret',
      fetchImpl,
      run: calls.run,
    }),
    /invalid JSON/i,
  );
  assert.equal(calls.calls.length, 0);
});

test('Open VSX rejects metadata that does not identify the requested artifact', async () => {
  const calls = callRecorder();
  const fetchImpl = async () =>
    response(200, {
      namespace: artifact.publisher,
      name: artifact.name,
      version: '9.9.9',
    });

  await assert.rejects(
    publishOpenVsx({
      ...artifact,
      token: 'open-vsx-secret',
      fetchImpl,
      run: calls.run,
    }),
  );
  assert.equal(
    calls.calls.length,
    0,
    'unexpected registry metadata must not trigger publishing',
  );
});

test('Open VSX requires a token before publishing an absent version', async () => {
  let requestCount = 0;
  const calls = callRecorder();
  const fetchImpl = async () => {
    requestCount += 1;
    return response(404, {});
  };

  await assert.rejects(
    publishOpenVsx({ ...artifact, token: '', fetchImpl, run: calls.run }),
    /OVSX_PAT|token|credential|auth/i,
  );
  assert.equal(
    requestCount,
    0,
    'publishing credentials are required before registry interaction',
  );
  assert.equal(calls.calls.length, 0);
});

test('Marketplace publishes the prepared VSIX with duplicate skipping and keeps its token out of argv', async () => {
  const calls = callRecorder();
  const token = 'marketplace-secret';

  await publishMarketplace({ ...artifact, token, run: calls.run });

  assert.equal(calls.calls.length, 1);
  const { args, options } = calls.calls[0];
  const packagePathIndex = args.indexOf('--packagePath');
  assert.notEqual(
    packagePathIndex,
    -1,
    'vsce receives an explicit package path',
  );
  assert.equal(args[packagePathIndex + 1], path.resolve(artifact.vsixPath));
  assert.ok(
    args.includes('--skip-duplicate'),
    'rerunning a release safely skips an existing version',
  );
  assert.ok(!args.includes(token));
  assert.ok(!JSON.stringify(args).includes(token));
  assert.ok(
    JSON.stringify(options).includes(token),
    'the credential is supplied through the child environment',
  );
});

test('Marketplace reports an existing duplicate as already published', async () => {
  const calls = callRecorder({
    code: 0,
    stdout: 'Version already published; skipping publish.',
  });

  const result = await publishMarketplace({
    ...artifact,
    token: 'marketplace-secret',
    run: calls.run,
  });

  assert.deepEqual(result, { status: 'already-published' });
});

test('Marketplace CLI failures are reported to the caller', async () => {
  const run = async () => {
    throw new Error('publisher CLI failed');
  };

  await assert.rejects(
    publishMarketplace({ ...artifact, token: 'marketplace-secret', run }),
    /publish|failed|error/i,
  );
});

test('nonzero publisher results fail without exposing the token', async () => {
  const token = 'marketplace-secret';
  const run = async () => ({
    code: 1,
    stderr: `Authentication failed for ${token}`,
  });

  await assert.rejects(
    publishMarketplace({ ...artifact, token, run }),
    (error) => {
      assert.match(error.message, /Publisher command failed/);
      assert.match(error.message, /\[REDACTED\]/);
      assert.ok(!error.message.includes(token));
      return true;
    },
  );
});

test('Open VSX CLI failures are reported after the version is confirmed absent', async () => {
  const fetchImpl = async () => response(404, {});
  const run = async () => {
    throw new Error('Open VSX publisher CLI failed');
  };

  await assert.rejects(
    publishOpenVsx({ ...artifact, token: 'open-vsx-secret', fetchImpl, run }),
    /publish|failed|error/i,
  );
});
