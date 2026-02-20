#!/usr/bin/env node

// World Clock CLI — shows current time in multiple timezones

const DEFAULT_ZONES = [
  { name: "New York", zone: "America/New_York" },
  { name: "London", zone: "Europe/London" },
  { name: "Tokyo", zone: "Asia/Tokyo" },
];

function isValidZone(zone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function formatTime(date, timeZone) {
  return date.toLocaleTimeString("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function showClocks(zones) {
  const now = new Date();
  console.log(`\n🕐 World Clock — ${now.toLocaleDateString()}\n`);
  for (const { name, zone } of zones) {
    if (!isValidZone(zone)) {
      console.error(`  ${name.padEnd(15)} ⚠ Invalid timezone: "${zone}"`);
      continue;
    }
    const time = formatTime(now, zone);
    console.log(`  ${name.padEnd(15)} ${time}`);
  }
  console.log();
}

// Parse --zone flags from argv
function parseZones(args) {
  const zones = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--zone" && i + 1 < args.length) {
      const zone = args[i + 1];
      // Derive a friendly display name from the IANA zone id
      const name = zone.split("/").pop().replace(/_/g, " ");
      zones.push({ name, zone });
      i++; // skip the value
    }
  }
  return zones;
}

const args = process.argv.slice(2);
const customZones = parseZones(args);

function showAllZones() {
  const now = new Date();
  const allZones = Intl.supportedValuesOf("timeZone");

  // Group by region (first segment of the IANA id)
  const grouped = {};
  for (const zone of allZones) {
    const region = zone.split("/")[0];
    if (!grouped[region]) grouped[region] = [];
    grouped[region].push(zone);
  }

  console.log(`\n🕐 World Clock — All Timezones (${allZones.length})\n`);

  for (const region of Object.keys(grouped).sort()) {
    console.log(`  ── ${region} ──`);
    for (const zone of grouped[region]) {
      const name = zone.split("/").pop().replace(/_/g, " ");
      const time = formatTime(now, zone);
      console.log(`    ${name.padEnd(22)} ${time}  (${zone})`);
    }
    console.log();
  }
}

// TODO: Add more default zones (Sydney, Dubai, São Paulo, etc.)
// TODO: Add --format flag for 24-hour time
// TODO: Add --live flag that refreshes every second

if (args.includes("--all")) {
  showAllZones();
} else {
  showClocks(customZones.length > 0 ? customZones : DEFAULT_ZONES);
}
