const suppliedUrl = process.env.MENYU_TEST_URL || process.argv[2];

if (!suppliedUrl) {
  throw new Error("Provide the deployed test URL: MENYU_TEST_URL=https://example.vercel.app npm run preflight:team-test");
}

const baseUrl = new URL(suppliedUrl);
baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") || "/";
baseUrl.search = "";
baseUrl.hash = "";
const base = baseUrl.toString().replace(/\/$/, "");

async function request(path) {
  const response = await fetch(`${base}${path}`, { redirect: "error" });
  return { response, body: await response.text() };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expect(path, verifier) {
  const { response, body } = await request(path);
  verifier(response, body);
  console.log(`✓ ${path}`);
}

await expect("/", (response, body) => {
  assert(response.ok, `Expected the app shell to load, received ${response.status}`);
  assert(response.headers.get("content-type")?.includes("text/html"), "App shell did not return HTML");
  assert(body.includes('id="root"'), "App shell is missing its React mount point");
  assert(response.headers.get("content-security-policy")?.includes("default-src 'self'"), "Content Security Policy is missing");
});

await expect("/manifest.webmanifest", (response, body) => {
  assert(response.ok, `Expected the PWA manifest, received ${response.status}`);
  const manifest = JSON.parse(body);
  assert(manifest.short_name === "The Menyu", "PWA short name must be The Menyu");
  assert(manifest.display === "standalone", "PWA must use standalone display mode");
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, "PWA icons are missing");
});

for (const asset of ["/brand/the-menyu-icon-192.png", "/brand/the-menyu-icon-512.png", "/brand/chip-chop-mascot.png"]) {
  await expect(asset, (response) => {
    assert(response.ok, `Expected brand asset ${asset}, received ${response.status}`);
    assert(response.headers.get("content-type")?.startsWith("image/"), `${asset} did not return an image`);
  });
}

await expect("/api/health", (response, body) => {
  assert(response.ok, `Expected API health, received ${response.status}`);
  assert(JSON.parse(body).ok === true, "API health response was not healthy");
});

await expect("/api/auth/status", (response, body) => {
  assert(response.ok, `Expected auth status, received ${response.status}`);
  assert(JSON.parse(body).required === true, "Staff access must be required for the team test");
});

await expect("/api/events", (response) => {
  assert(response.status === 401, `Unauthenticated event data must be blocked, received ${response.status}`);
});

console.log(`\nTeam-test preflight passed for ${base}`);
