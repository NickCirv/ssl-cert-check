# ssl-cert-check

Zero-dependency CLI to check SSL certificate expiry for multiple domains in parallel. Color-coded alerts, JSON/CSV output, file input, full chain inspection — all with Node.js built-ins only.

## Install

```bash
npm install -g ssl-cert-check
```

Or run without installing:

```bash
npx ssl-cert-check github.com
```

## Usage

```bash
# Check one or more domains
sslcheck github.com google.com cloudflare.com

# Custom port
sslcheck example.com:8443

# Read from file
sslcheck --file domains.txt

# Change warning threshold (default: 30 days)
sslcheck github.com --warn-days 14

# JSON output (great for CI/monitoring pipelines)
sslcheck github.com --format json

# CSV output
sslcheck github.com --format csv

# Show full certificate chain
sslcheck github.com --chain

# Custom timeout (seconds, default: 10)
sslcheck github.com --timeout 5
```

## Output

### Table (default)

```
SSL Certificate Report  (warn threshold: 30d)

────────────────────────────────────────────────────────────────────────────────
✓ github.com                              87d
  Issuer : DigiCert Inc
  Subject: github.com
  Valid  : 2025-03-06 → 2026-06-07
  SHA1   : AB:CD:12:34...
────────────────────────────────────────────────────────────────────────────────

Summary: OK: 1  Warning: 0  Critical: 0  Expired: 0  Errors: 0
```

### Color coding

| Color  | Meaning                          |
|--------|----------------------------------|
| Green  | More than 30 days remaining      |
| Yellow | Within warn-days threshold        |
| Red    | Less than 7 days or expired      |

### JSON output

```json
[
  {
    "host": "github.com",
    "port": 443,
    "daysLeft": 87,
    "validFrom": "2025-03-06T00:00:00.000Z",
    "validTo": "2026-06-07T23:59:59.000Z",
    "subject": "github.com",
    "issuer": "DigiCert Inc",
    "serialNumber": "...",
    "fingerprint": "AB:CD:...",
    "san": "DNS:github.com, DNS:www.github.com"
  }
]
```

## domains.txt format

```
# Comments are ignored
github.com
google.com
example.com:8443
```

## Exit codes

| Code | Meaning                                                       |
|------|---------------------------------------------------------------|
| `0`  | All certs valid and beyond warn-days threshold                |
| `1`  | One or more certs expire within warn-days, are expired, or errored |

Use exit code 1 in CI to alert before certs expire:

```bash
sslcheck --file domains.txt --warn-days 14 || echo "ALERT: certs expiring soon"
```

## Options

| Flag                | Default | Description                         |
|---------------------|---------|-------------------------------------|
| `-f, --file <path>` | —       | Read domains from file              |
| `-w, --warn-days`   | `30`    | Warning threshold in days           |
| `--format`          | `table` | Output format: `table`, `json`, `csv` |
| `--chain`           | off     | Show full certificate chain         |
| `--timeout <sec>`   | `10`    | Per-domain connection timeout       |
| `-h, --help`        | —       | Show help                           |

## Requirements

- Node.js 18+
- Zero npm dependencies — uses only `node:tls`, `node:fs` built-ins

## License

MIT
