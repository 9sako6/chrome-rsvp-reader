const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("project keeps the canonical Apache license and identifies the copyright holder in NOTICE", () => {
  const license = read("LICENSE");
  const notice = read("NOTICE");
  const packageMetadata = JSON.parse(read("package.json"));

  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.doesNotMatch(license, /Copyright 2026 Yutaro Taira/);
  assert.equal(notice.trim(), "Copyright 2026 Yutaro Taira (9sako6)");
  assert.equal(packageMetadata.license, "Apache-2.0");
});

test("bundled Kagome WASM includes all upstream license notices", () => {
  assert.match(read("vendor/kagome/LICENSES/KAGOME-MIT.txt"), /Copyright \(c\) 2020 ikawaha/);
  assert.match(read("vendor/kagome/LICENSES/KAGOME-DICT-MIT.txt"), /Copyright \(c\) 2020 ikawaha/);
  assert.match(read("vendor/kagome/LICENSES/UNIDIC-BSD.txt"), /Copyright \(c\) 2011-2013, The UniDic Consortium/);
  assert.match(read("vendor/kagome/LICENSES/GO-BSD.txt"), /Copyright 2009 The Go Authors/);
});
