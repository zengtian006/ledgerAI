// TestFlight helper for the App Store Connect API.
//   node scripts/testflight.mjs next-build                 print the next free build number
//   node scripts/testflight.mjs wait <build>               wait until that build finished processing
//   node scripts/testflight.mjs status                     list recent builds and their state
//   node scripts/testflight.mjs distribute <build> [--group "Name"] [--notes "What to test"] [--emails a@b.com,c@d.com] [--external]
// Credentials: source ~/.appstoreconnect/env (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID)
import { asc, AscError } from './asc.mjs';

const BUNDLE_ID = 'click.ledgerai.app';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function appId() {
  const res = await asc('GET', '/v1/apps?limit=200&fields[apps]=bundleId');
  const app = res.data.find((a) => a.attributes.bundleId === BUNDLE_ID);
  if (!app) throw new Error(`No app with bundle ID ${BUNDLE_ID} in App Store Connect. Create the app record first.`);
  return app.id;
}

async function builds(app, limit = 50) {
  const res = await asc('GET', `/v1/builds?filter[app]=${app}&limit=${limit}&sort=-uploadedDate&include=preReleaseVersion`);
  const versions = new Map((res.included ?? []).filter((i) => i.type === 'preReleaseVersions').map((v) => [v.id, v.attributes.version]));
  return res.data.map((b) => ({
    id: b.id,
    build: b.attributes.version,
    version: versions.get(b.relationships?.preReleaseVersion?.data?.id) ?? '?',
    state: b.attributes.processingState,
    expired: b.attributes.expired,
    uploaded: b.attributes.uploadedDate,
  }));
}

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function nextBuild() {
  const all = await builds(await appId(), 200);
  const max = all.reduce((m, b) => Math.max(m, parseInt(b.build, 10) || 0), 0);
  console.log(max + 1);
}

async function findBuild(app, buildNumber) {
  return (await builds(app, 100)).find((b) => b.build === String(buildNumber)) ?? null;
}

async function wait(buildNumber, timeoutMin = 45) {
  const app = await appId();
  const deadline = Date.now() + timeoutMin * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const b = await findBuild(app, buildNumber);
    const state = b ? b.state : 'NOT_YET_VISIBLE';
    if (state !== last) console.log(`  build ${buildNumber}: ${state}`);
    last = state;
    if (state === 'VALID') return b;
    if (state === 'INVALID' || state === 'FAILED') throw new Error(`Build ${buildNumber} ended in state ${state}. Check the email from App Store Connect.`);
    await sleep(30_000);
  }
  throw new Error(`Timed out waiting for build ${buildNumber} to process`);
}

async function status() {
  for (const b of await builds(await appId(), 10)) console.log(`${b.version} (${b.build})  ${b.state}${b.expired ? '  EXPIRED' : ''}  ${b.uploaded}`);
}

async function ensureGroup(app, name, external) {
  const groups = await asc('GET', `/v1/apps/${app}/betaGroups?limit=200`);
  const existing = groups.data.find((g) => g.attributes.name === name);
  if (existing) return existing;
  const created = await asc('POST', '/v1/betaGroups', {
    data: {
      type: 'betaGroups',
      attributes: { name, isInternalGroup: !external, ...(external ? {} : { hasAccessToAllBuilds: true }) },
      relationships: { app: { data: { type: 'apps', id: app } } },
    },
  });
  console.log(`  created ${external ? 'external' : 'internal'} group "${name}"`);
  return created.data;
}

async function groupHasTester(group, email) {
  const members = await asc('GET', `/v1/betaGroups/${group.id}/betaTesters?limit=200`);
  return members.data.some((t) => t.attributes.email?.toLowerCase() === email);
}

async function addTester(group, email) {
  const lower = email.trim().toLowerCase();
  if (await groupHasTester(group, lower)) {
    console.log(`  ${lower} is already in the group`);
    return;
  }
  const found = await asc('GET', `/v1/betaTesters?filter[email]=${encodeURIComponent(lower)}&limit=1`);
  const existingId = found.data[0]?.id;
  if (existingId) {
    try {
      await asc('POST', `/v1/betaGroups/${group.id}/relationships/betaTesters`, { data: [{ type: 'betaTesters', id: existingId }] });
    } catch (err) {
      // Apple refuses to re-assign some existing tester records (409 STATE_ERROR); creating the tester
      // together with the group relationship works and is how a first invite is normally sent.
      if (!(err instanceof AscError && err.status === 409)) throw err;
      await asc('POST', '/v1/betaTesters', {
        data: {
          type: 'betaTesters',
          attributes: { email: lower, firstName: lower.split('@')[0], lastName: 'Tester' },
          relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group.id }] } },
        },
      });
    }
  } else {
    await asc('POST', '/v1/betaTesters', {
      data: {
        type: 'betaTesters',
        attributes: { email: lower, firstName: lower.split('@')[0], lastName: 'Tester' },
        relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group.id }] } },
      },
    });
  }
  // Never report success without checking the group really contains the tester
  if (!(await groupHasTester(group, lower))) throw new Error(`Could not add ${lower} to "${group.attributes.name}"`);
  console.log(`  added ${lower}`);
}

async function distribute(buildNumber) {
  const app = await appId();
  const build = await findBuild(app, buildNumber);
  if (!build || build.state !== 'VALID') throw new Error(`Build ${buildNumber} is not processed yet (state: ${build?.state ?? 'not found'}). Run "wait" first.`);

  const external = process.argv.includes('--external');
  const groupName = flag('group') ?? (external ? 'Beta Testers' : 'Internal Testers');
  const notes = flag('notes') ?? 'First TestFlight build. Please try signing up, scanning a receipt with the camera, and the Analytics tab.';
  const emails = (flag('emails') ?? '').split(',').map((e) => e.trim()).filter(Boolean);

  // "What to test" text (shown to testers in TestFlight)
  const locs = await asc('GET', `/v1/builds/${build.id}/betaBuildLocalizations`);
  const en = locs.data.find((l) => l.attributes.locale === 'en-US');
  if (en) {
    await asc('PATCH', `/v1/betaBuildLocalizations/${en.id}`, { data: { type: 'betaBuildLocalizations', id: en.id, attributes: { whatsNew: notes } } });
  } else {
    await asc('POST', '/v1/betaBuildLocalizations', {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale: 'en-US', whatsNew: notes },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    });
  }
  console.log('  set "What to test"');

  const group = await ensureGroup(app, groupName, external);
  for (const email of emails) await addTester(group, email);

  if (external) {
    await asc('POST', `/v1/builds/${build.id}/relationships/betaGroups`, { data: [{ type: 'betaGroups', id: group.id }] });
    console.log(`  added build ${buildNumber} to "${groupName}"`);
    try {
      await asc('POST', '/v1/betaAppReviewSubmissions', { data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: { type: 'builds', id: build.id } } } } });
      console.log('  submitted for Beta App Review');
    } catch (err) {
      console.log(`  Beta App Review not submitted yet:\n${err.message.replace(/^/gm, '    ')}`);
    }
  } else {
    console.log(`  internal group "${groupName}" has access to all builds, including ${buildNumber}`);
  }
}

const [cmd, arg] = process.argv.slice(2);
try {
  if (cmd === 'next-build') await nextBuild();
  else if (cmd === 'wait') await wait(arg);
  else if (cmd === 'status') await status();
  else if (cmd === 'distribute') await distribute(arg);
  else {
    console.error('Usage: testflight.mjs next-build | wait <build> | status | distribute <build> [options]  (see file header)');
    process.exit(2);
  }
} catch (err) {
  console.error(err instanceof AscError ? `App Store Connect API error (HTTP ${err.status}):\n${err.message}` : err.message);
  process.exit(1);
}
