const path = require('node:path');
const fs = require('node:fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
  const workspacePath = extensionDevelopmentPath;
  const isolatedUserDataDir = path.resolve(
    extensionDevelopmentPath,
    '.vscode-test',
    `user-data-${Date.now()}`,
  );
  const isolatedExtensionsDir = path.resolve(
    extensionDevelopmentPath,
    '.vscode-test',
    `extensions-${Date.now()}`,
  );

  fs.mkdirSync(isolatedUserDataDir, { recursive: true });
  fs.mkdirSync(isolatedExtensionsDir, { recursive: true });

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspacePath,
        '--disable-extensions',
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
