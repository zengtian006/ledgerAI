// Registers the app's bundle ID (App ID) through the App Store Connect API, idempotently, and lists its capabilities.
//   ASC_KEY_PATH=... ASC_KEY_ID=... ASC_ISSUER_ID=... node scripts/register_bundle_id.mjs [--dry-run]
import { asc, AscError } from './asc.mjs';

const IDENTIFIER = 'click.ledgerai.app';
const NAME = 'LedgerAI';
const dryRun = process.argv.includes('--dry-run');

async function findBundleId() {
  const res = await asc('GET', `/v1/bundleIds?filter[identifier]=${encodeURIComponent(IDENTIFIER)}&limit=50`);
  // The filter matches by prefix, so require an exact identifier
  return res.data.find((b) => b.attributes.identifier === IDENTIFIER) ?? null;
}

async function main() {
  // Read-only call first: proves the key, issuer and role work before anything is created
  const apps = await asc('GET', '/v1/apps?limit=5');
  console.log(`Authenticated. Apps visible to this key: ${apps.data.length}`);

  let bundle = await findBundleId();
  if (bundle) {
    console.log(`Bundle ID already registered: ${bundle.attributes.identifier} (${bundle.id})`);
  } else if (dryRun) {
    console.log(`[dry run] would register ${IDENTIFIER} as "${NAME}" (platform IOS)`);
    return;
  } else {
    const created = await asc('POST', '/v1/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: IDENTIFIER, name: NAME, platform: 'IOS' } },
    });
    bundle = created.data;
    console.log(`Registered bundle ID: ${bundle.attributes.identifier} (${bundle.id})`);
  }

  const { name, platform, seedId } = bundle.attributes;
  console.log(`  name=${name}  platform=${platform}  team(seed)=${seedId}`);

  const caps = await asc('GET', `/v1/bundleIds/${bundle.id}/bundleIdCapabilities`);
  console.log(`Capabilities enabled (${caps.data.length}):`);
  for (const c of caps.data) console.log(`  - ${c.attributes.capabilityType}`);
  if (!caps.data.length) console.log('  (none beyond the defaults every App ID has)');
}

main().catch((err) => {
  if (err instanceof AscError) {
    console.error(`App Store Connect API error (HTTP ${err.status}):\n${err.message}`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
