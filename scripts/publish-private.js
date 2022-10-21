const path = require("path");
const { execSync } = require("child_process");
const semver = require("semver");
const jsonfile = require("jsonfile");

const buildDir = path.resolve(__dirname, "../build/node_modules");

function getTaggedVersion() {
  const output = execSync("git tag --list --points-at HEAD").toString().trim();
  return output.replace(/^v/g, "");
}

/**
 * @param {string} dir
 * @param {string} tag
 */
function publish(dir, tag) {
  execSync(`npm publish --tag ${tag} ${dir}`, { stdio: "inherit" });
}

async function run() {
  // Make sure there's a current tag
  const taggedVersion = getTaggedVersion();
  if (taggedVersion === "") {
    console.error("Missing release version. Run the version script first.");
    process.exit(1);
  }

  const prerelease = semver.prerelease(taggedVersion);
  const prereleaseTag = prerelease ? String(prerelease[0]) : undefined;
  const tag = prereleaseTag
    ? prereleaseTag.includes("nightly")
      ? "nightly"
      : prereleaseTag.includes("experimental")
      ? "experimental"
      : prereleaseTag
    : "latest";

  // Publish all @remix-run/* packages
  for (const name of [
    "dev",
    "server-runtime", // publish before platforms
    "cloudflare",
    "cloudflare-pages",
    "cloudflare-workers",
    "deno",
    "node", // publish node before node servers
    "architect",
    "express", // publish express before serve
    "vercel",
    "netlify",
    "react",
    "serve",
  ]) {
    // fix for https://github.com/remix-run/remix/actions/runs/1500713248
    await updatePackageConfig(name, (config) => {
      config.repository = "https://github.com/remix-run/packages";
    });
    publish(path.join(buildDir, "@remix-run", name), tag);
  }
}

run().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);

/**
 * @param {string} packageName
 * @param {(json: import('type-fest').PackageJson) => any} transform
 */
async function updatePackageConfig(packageName, transform) {
  const file = path.join(buildDir, "@remix-run", packageName, "package.json");
  const json = await jsonfile.readFile(file);
  transform(json);
  await jsonfile.writeFile(file, json, { spaces: 2 });
}
