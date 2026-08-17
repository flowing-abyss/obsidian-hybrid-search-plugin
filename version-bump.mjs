import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// Run outside `npm version` this variable is unset, and writing it anyway is how
// versions.json ended up with an "undefined" entry.
if (!targetVersion) {
  throw new Error('npm_package_version is not set — run this through `npm version`, not directly.');
}

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

// update versions.json with target version and minAppVersion from manifest.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, 2)}\n`);
