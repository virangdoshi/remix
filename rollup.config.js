const fs = require("fs");
const path = require("path");

module.exports = function rollup(options) {
  return fs.readdirSync("packages").flatMap((dir) => {
    const configPath = path.join("packages", dir, "rollup.config.js");
    try {
      fs.readFileSync(configPath);
    } catch (e) {
      return [];
    }
    const packageBuild = require(`.${path.sep}${configPath}`);
    return packageBuild(options);
  });
};
