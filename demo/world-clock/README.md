# World Clock CLI

A zero-dependency command-line tool that shows the current time across multiple timezones. Built on Node.js `Intl` APIs for accurate IANA timezone support.

## Usage

```bash
node index.js                                        # Show default zones
node index.js --zone America/Los_Angeles             # Show a specific zone
node index.js --zone Asia/Tokyo --zone Europe/Paris  # Multiple zones
node index.js --all                                  # All IANA timezones, grouped by region
```

### Example output

```
🕐 World Clock — 2/20/2026

  New York        02:30:15 PM
  London          07:30:15 PM
  Tokyo           03:30:15 AM
```

## Flags

| Flag | Description |
|------|-------------|
| `--zone <IANA_ID>` | Display time for a specific timezone. Repeatable. |
| `--all` | List all supported IANA timezones grouped by region. |

## Default zones

New York, London, and Tokyo are shown when no flags are provided.

## Error handling

Invalid timezone names are caught gracefully — you'll see a warning instead of a stack trace.

```
  InvalidPlace    ⚠ Invalid timezone: "InvalidPlace"
```

## Requirements

Node.js 18+ (uses `Intl.supportedValuesOf` and `Intl.DateTimeFormat`).
