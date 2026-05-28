const path = require('node:path');
const fs = require('node:fs');
const { runTests, runVSCodeCommand } = require('@vscode/test-electron');

function getPackagedVsixPath(extensionRoot) {
  const packageJson = require(path.join(extensionRoot, 'package.json'));
  const vsixPath = path.join(
    extensionRoot,
    `${packageJson.name}-${packageJson.version}.vsix`,
  );

  if (!fs.existsSync(vsixPath)) {
    throw new Error(`Packaged VSIX not found at ${vsixPath}`);
  }

  return vsixPath;
}

async function main() {
  // The same smoke suite can run against source during CI or against the
  // packaged VSIX that would be shipped to users.
  const runPackagedVsix = process.argv.includes('--vsix');
  const extensionRoot = path.resolve(__dirname, '..', '..');
  const packageRunnerPath = path.resolve(__dirname, 'packageRunner');
  const extensionDevelopmentPath = runPackagedVsix
    ? packageRunnerPath
    : extensionRoot;
  const extensionTestsPath = path.resolve(
    __dirname,
    'suite',
    runPackagedVsix ? 'package.js' : 'index.js',
  );
  const workspacePath = extensionRoot;
  const isolatedUserDataDir = path.resolve(
    extensionRoot,
    '.vscode-test',
    `user-data-${Date.now()}`,
  );
  const isolatedExtensionsDir = path.resolve(
    extensionRoot,
    '.vscode-test',
    `extensions-${Date.now()}`,
  );

  // Use fresh VS Code state each run so installed extensions and user settings
  // from a developer machine cannot make the smoke tests pass or fail.
  fs.mkdirSync(isolatedUserDataDir, { recursive: true });
  fs.mkdirSync(isolatedExtensionsDir, { recursive: true });

  try {
    if (runPackagedVsix) {
      // Packaged tests install the VSIX into a tiny host extension so we exercise
      // the artifact layout, not the checkout on disk.
      await runVSCodeCommand([
        '--install-extension',
        getPackagedVsixPath(extensionRoot),
        '--force',
        '--user-data-dir',
        isolatedUserDataDir,
        '--extensions-dir',
        isolatedExtensionsDir,
      ]);
    }

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        SIMPLE_HTML_VIEWER_EXPECT_PACKAGED: runPackagedVsix ? '1' : '0',
        SIMPLE_HTML_VIEWER_WORKSPACE: extensionRoot,
      },
      launchArgs: [
        workspacePath,
        ...(runPackagedVsix ? [] : ['--disable-extensions']),
        '--user-data-dir',
        isolatedUserDataDir,
        '--extensions-dir',
        isolatedExtensionsDir,
      ],
    });
  } catch (error) {
    console.error('Smoke tests failed');
    console.error(error);
    process.exit(1);
  }
}

void main();
