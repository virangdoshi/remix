const fsp = require("fs").promises;
const chalk = require("chalk");
const path = require("path");
const { execSync } = require("child_process");
const jsonfile = require("jsonfile");
const Confirm = require("prompt-confirm");

const rootDir = path.resolve(__dirname, "..");

const remixPackages = {
  adapters: [
    "architect",
    "cloudflare-pages",
    "cloudflare-workers",
    "express",
    "netlify",
    "vercel",
  ],
  runtimes: ["cloudflare", "deno", "node"],
  core: ["dev", "server-runtime", "react", "eslint-config"],
  get all() {
    return [...this.adapters, ...this.runtimes, ...this.core, "serve"];
  },
};

/**
 * @param {string} packageName
 * @param {string} [directory]
 * @returns {string}
 */
function packageJson(packageName, directory = "") {
  return path.join(rootDir, directory, packageName, "package.json");
}

/**
 * @param {string} packageName
 * @returns {Promise<string | undefined>}
 */
async function getPackageVersion(packageName) {
  const file = packageJson(packageName, "packages");
  const json = await jsonfile.readFile(file);
  return json.version;
}

/**
 * @returns {void}
 */
function ensureCleanWorkingDirectory() {
  const status = execSync("git status --porcelain").toString().trim();
  const lines = status.split("\n");
  if (!lines.every((line) => line === "" || line.startsWith("?"))) {
    console.error(
      "Working directory is not clean. Please commit or stash your changes."
    );
    process.exit(1);
  }
}

/**
 * @param {string} question
 * @returns {Promise<string | boolean>}
 */
async function prompt(question) {
  const confirm = new Confirm(question);
  const answer = await confirm.run();
  return answer;
}

/**
 * @param {string} packageName
 * @param {(json: import('type-fest').PackageJson) => any} transform
 */
async function updatePackageConfig(packageName, transform) {
  const file = packageJson(packageName, "packages");
  try {
    const json = await jsonfile.readFile(file);
    if (!json) {
      console.log(`No package.json found for ${packageName}; skipping`);
      return;
    }
    transform(json);
    await jsonfile.writeFile(file, json, { spaces: 2 });
  } catch (err) {}
}

/**
 * @param {string} packageName
 * @param {string} nextVersion
 * @param {string} [successMessage]
 */
async function updateRemixVersion(packageName, nextVersion, successMessage) {
  await updatePackageConfig(packageName, (config) => {
    config.version = nextVersion;
    for (const pkg of remixPackages.all) {
      if (config.dependencies?.[`@remix-run/${pkg}`]) {
        config.dependencies[`@remix-run/${pkg}`] = nextVersion;
      }
      if (config.devDependencies?.[`@remix-run/${pkg}`]) {
        config.devDependencies[`@remix-run/${pkg}`] = nextVersion;
      }
      if (config.peerDependencies?.[`@remix-run/${pkg}`]) {
        config.peerDependencies[`@remix-run/${pkg}`] = nextVersion;
      }
    }
  });
  const logName = packageName.startsWith("remix-")
    ? `@remix-run/${packageName.slice(6)}`
    : packageName;
  console.log(
    chalk.green(
      `  ${
        successMessage ||
        `Updated ${chalk.bold(logName)} to version ${chalk.bold(nextVersion)}`
      }`
    )
  );
}

/**
 *
 * @param {string} nextVersion
 */
async function updateDeploymentScriptVersion(nextVersion) {
  const file = packageJson("deployment-test", "scripts");
  const json = await jsonfile.readFile(file);
  json.dependencies["@remix-run/dev"] = nextVersion;
  await jsonfile.writeFile(file, json, { spaces: 2 });

  console.log(
    chalk.green(
      `  Updated Remix to version ${chalk.bold(nextVersion)} in ${chalk.bold(
        "scripts/deployment-test"
      )}`
    )
  );
}

/**
 * @param {string} importSpecifier
 * @returns {[string, string]} [packageName, importPath]
 */
const getPackageNameFromImportSpecifier = (importSpecifier) => {
  if (importSpecifier.startsWith("@")) {
    const [scope, pkg, ...path] = importSpecifier.split("/");
    return [`${scope}/${pkg}`, path.join("/")];
  }

  const [pkg, ...path] = importSpecifier.split("/");
  return [pkg, path.join("/")];
};
/**
 * @param {string} importMapPath
 * @param {string} nextVersion
 */
const updateDenoImportMap = async (importMapPath, nextVersion) => {
  const { imports, ...json } = await jsonfile.readFile(importMapPath);
  const remixPackagesFull = remixPackages.all.map(
    (remixPackage) => `@remix-run/${remixPackage}`
  );

  const newImports = Object.fromEntries(
    Object.entries(imports).map(([importName, path]) => {
      const [packageName, importPath] =
        getPackageNameFromImportSpecifier(importName);

      return remixPackagesFull.includes(packageName)
        ? [
            importName,
            `https://esm.sh/${packageName}@${nextVersion}${
              importPath ? `/${importPath}` : ""
            }`,
          ]
        : [importName, path];
    })
  );

  return jsonfile.writeFile(
    importMapPath,
    { ...json, imports: newImports },
    { spaces: 2 }
  );
};

/**
 * @param {string} nextVersion
 */
async function incrementRemixVersion(nextVersion) {
  // Update version numbers in package.json for all packages
  await updateRemixVersion("remix", nextVersion);
  await updateRemixVersion("create-remix", nextVersion);
  for (const name of remixPackages.all) {
    await updateRemixVersion(`remix-${name}`, nextVersion);
  }

  // Update version numbers in Deno's import maps
  await Promise.all(
    [
      path.join(".vscode", "deno_resolve_npm_imports.json"),
      path.join("templates", "deno", ".vscode", "resolve_npm_imports.json"),
    ].map((importMapPath) =>
      updateDenoImportMap(path.join(rootDir, importMapPath), nextVersion)
    )
  );

  // Update deployment script `@remix-run/dev` version
  await updateDeploymentScriptVersion(nextVersion);

  // Commit and tag
  execSync(`git commit --all --message="Version ${nextVersion}"`);
  execSync(`git tag -a -m "Version ${nextVersion}" v${nextVersion}`);
  console.log(chalk.green(`  Committed and tagged version ${nextVersion}`));
}

/**
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fsp.stat(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

exports.rootDir = rootDir;
exports.remixPackages = remixPackages;
exports.fileExists = fileExists;
exports.packageJson = packageJson;
exports.getPackageVersion = getPackageVersion;
exports.ensureCleanWorkingDirectory = ensureCleanWorkingDirectory;
exports.prompt = prompt;
exports.updatePackageConfig = updatePackageConfig;
exports.updateRemixVersion = updateRemixVersion;
exports.incrementRemixVersion = incrementRemixVersion;
