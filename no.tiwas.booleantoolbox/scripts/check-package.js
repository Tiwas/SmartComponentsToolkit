const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const appDirectory = path.resolve(__dirname, '..');
const maximumSizeMB = Number(process.env.HOMEY_BUNDLE_MAX_SIZE_MB || 10);

if (!Number.isFinite(maximumSizeMB) || maximumSizeMB <= 0) {
  throw new Error('HOMEY_BUNDLE_MAX_SIZE_MB must be a positive number.');
}

const homeyCommand = process.platform === 'win32' ? 'homey.cmd' : 'homey';
const validation = spawnSync(homeyCommand, ['app', 'validate', '--level=publish'], {
  cwd: appDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (validation.error || validation.status !== 0) {
  throw validation.error || new Error('Homey publish validation failed.');
}

const buildDirectory = path.join(appDirectory, '.homeybuild');
if (!fs.existsSync(buildDirectory)) {
  throw new Error('.homeybuild was not generated.');
}

function getFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? getFiles(entryPath) : [entryPath];
  });
}

function findAssetReferences(value, references = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('/assets/')) references.add(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => findAssetReferences(item, references));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => findAssetReferences(item, references));
  }
  return references;
}

const includedFiles = getFiles(buildDirectory);
const forbiddenFiles = includedFiles.filter((filePath) => {
  const relativePath = path.relative(buildDirectory, filePath);
  const segments = relativePath.split(path.sep);
  const name = path.basename(filePath);

  return !segments.includes('node_modules') && (
    name.endsWith('.test.js') ||
    name.endsWith('.bak') ||
    name.endsWith('.log') ||
    segments.some((segment) => ['coverage', 'tests', 'scripts', '.codex-logs'].includes(segment)) ||
    segments.some((segment) => segment.endsWith('.backup'))
  );
});

if (forbiddenFiles.length > 0) {
  throw new Error(`Development artifacts were included in the Homey bundle:\n${forbiddenFiles.join('\n')}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(buildDirectory, 'app.json'), 'utf8'));
const assetReferences = findAssetReferences(manifest);
for (const assetReference of assetReferences) {
  const assetPath = path.join(buildDirectory, assetReference.slice(1));
  if (!fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
    throw new Error(`Manifest asset is missing from the Homey bundle: ${assetReference}`);
  }
}

const sizeBytes = includedFiles.reduce((total, filePath) => total + fs.statSync(filePath).size, 0);
const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
console.log(`Homey bundle: ${includedFiles.length} files, ${sizeMB} MB; ${assetReferences.size} manifest assets verified`);

if (sizeBytes > maximumSizeMB * 1024 * 1024) {
  throw new Error(`Homey bundle exceeds the ${maximumSizeMB} MB limit.`);
}
