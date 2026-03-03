#!/usr/bin/env node
'use strict';

import tls from 'node:tls';
import { readFileSync } from 'node:fs';

// ── ANSI colours ─────────────────────────────────────────────────────────────
const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

function colorDays(days, warnDays) {
  if (days < 0)         return `${RED}${BOLD}EXPIRED (${Math.abs(days)}d ago)${RESET}`;
  if (days < 7)         return `${RED}${BOLD}${days}d${RESET}`;
  if (days <= warnDays) return `${YELLOW}${days}d${RESET}`;
  return `${GREEN}${days}d${RESET}`;
}

// ── Certificate check ─────────────────────────────────────────────────────────
function checkCert(host, port, includeChain, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ host, port, error: 'Timeout after 10s' });
    }, timeoutMs);

    let socket;
    try {
      socket = tls.connect(
        { host, port, servername: host, rejectUnauthorized: false },
        () => {
          try {
            const cert = socket.getPeerCertificate(true);
            if (!cert || !cert.valid_to) {
              socket.destroy();
              done({ host, port, error: 'No certificate returned' });
              return;
            }

            const validTo   = new Date(cert.valid_to);
            const validFrom = new Date(cert.valid_from);
            const now       = new Date();
            const msPerDay  = 1000 * 60 * 60 * 24;
            const daysLeft  = Math.floor((validTo - now) / msPerDay);

            const result = {
              host,
              port,
              daysLeft,
              validFrom: validFrom.toISOString(),
              validTo:   validTo.toISOString(),
              subject:   cert.subject ? (cert.subject.CN || '') : '',
              issuer:    cert.issuer  ? (cert.issuer.O  || cert.issuer.CN || '') : '',
              serialNumber: cert.serialNumber || '',
              fingerprint: cert.fingerprint || '',
              san: cert.subjectaltname || '',
            };

            if (includeChain) {
              const chain = [];
              let cur = cert;
              while (cur) {
                chain.push({
                  subject: cur.subject ? (cur.subject.CN || '') : '',
                  issuer:  cur.issuer  ? (cur.issuer.O || cur.issuer.CN || '') : '',
                  validTo: cur.valid_to ? new Date(cur.valid_to).toISOString() : '',
                });
                const next = cur.issuerCertificate;
                if (!next || next === cur) break;
                cur = next;
              }
              result.chain = chain;
            }

            socket.destroy();
            done(result);
          } catch (err) {
            socket.destroy();
            done({ host, port, error: err.message });
          }
        }
      );
    } catch (err) {
      done({ host, port, error: err.message });
      return;
    }

    socket.on('error', (err) => {
      done({ host, port, error: err.message });
    });
  });
}

// ── Output formatters ─────────────────────────────────────────────────────────
function printTable(results, warnDays) {
  const width = 40;
  console.log(`\n${BOLD}${CYAN}SSL Certificate Report${RESET}  ${DIM}(warn threshold: ${warnDays}d)${RESET}\n`);
  const line = '─'.repeat(80);
  console.log(`${DIM}${line}${RESET}`);

  for (const r of results) {
    const label = r.port !== 443 ? `${r.host}:${r.port}` : r.host;
    if (r.error) {
      console.log(`${RED}✗${RESET} ${BOLD}${label.padEnd(width)}${RESET}  ${RED}Error: ${r.error}${RESET}`);
      console.log(`${DIM}${line}${RESET}`);
      continue;
    }
    const icon = r.daysLeft < 0 ? `${RED}✗${RESET}` : r.daysLeft <= warnDays ? `${YELLOW}⚠${RESET}` : `${GREEN}✓${RESET}`;
    console.log(`${icon} ${BOLD}${label.padEnd(width)}${RESET}  ${colorDays(r.daysLeft, warnDays)}`);
    console.log(`  ${DIM}Issuer : ${r.issuer}${RESET}`);
    console.log(`  ${DIM}Subject: ${r.subject}${RESET}`);
    console.log(`  ${DIM}Valid  : ${r.validFrom.slice(0, 10)} → ${r.validTo.slice(0, 10)}${RESET}`);
    if (r.fingerprint) {
      console.log(`  ${DIM}SHA1   : ${r.fingerprint}${RESET}`);
    }
    if (r.chain && r.chain.length > 1) {
      console.log(`  ${DIM}Chain  :${RESET}`);
      for (const c of r.chain) {
        console.log(`           ${DIM}${c.subject} (${c.issuer}) → ${c.validTo.slice(0, 10)}${RESET}`);
      }
    }
    console.log(`${DIM}${line}${RESET}`);
  }

  const expired  = results.filter(r => !r.error && r.daysLeft < 0);
  const critical = results.filter(r => !r.error && r.daysLeft >= 0 && r.daysLeft < 7);
  const warning  = results.filter(r => !r.error && r.daysLeft >= 7 && r.daysLeft <= warnDays);
  const ok       = results.filter(r => !r.error && r.daysLeft > warnDays);
  const errors   = results.filter(r => r.error);

  console.log(`\n${BOLD}Summary:${RESET} ${GREEN}OK: ${ok.length}${RESET}  ${YELLOW}Warning: ${warning.length}${RESET}  ${RED}Critical: ${critical.length}  Expired: ${expired.length}  Errors: ${errors.length}${RESET}\n`);
}

function printJson(results) {
  console.log(JSON.stringify(results, null, 2));
}

function printCsv(results) {
  const headers = ['host', 'port', 'daysLeft', 'validFrom', 'validTo', 'subject', 'issuer', 'fingerprint', 'error'];
  console.log(headers.join(','));
  for (const r of results) {
    const row = headers.map(h => {
      const val = r[h] !== undefined ? String(r[h]) : '';
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    });
    console.log(row.join(','));
  }
}

// ── Argument parser ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    domains: [],
    file: null,
    warnDays: 30,
    format: 'table',
    chain: false,
    help: false,
    timeout: 10_000,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h')      { opts.help = true; continue; }
    if (a === '--chain')                   { opts.chain = true; continue; }
    if (a === '--file' || a === '-f')      { opts.file = args[++i]; continue; }
    if (a === '--warn-days' || a === '-w') { opts.warnDays = parseInt(args[++i], 10) || 30; continue; }
    if (a === '--format')                  { opts.format = args[++i] || 'table'; continue; }
    if (a === '--timeout')                 { opts.timeout = (parseInt(args[++i], 10) || 10) * 1000; continue; }
    if (!a.startsWith('-'))               { opts.domains.push(a); }
  }
  return opts;
}

function parseDomainArg(raw) {
  // Support example.com:8443 or bare domain
  const colonIdx = raw.lastIndexOf(':');
  if (colonIdx > 0) {
    const maybePort = parseInt(raw.slice(colonIdx + 1), 10);
    if (!isNaN(maybePort) && maybePort > 0 && maybePort <= 65535) {
      return { host: raw.slice(0, colonIdx), port: maybePort };
    }
  }
  return { host: raw, port: 443 };
}

function printHelp() {
  console.log(`
${BOLD}ssl-cert-check${RESET} — Zero-dependency SSL certificate expiry checker

${BOLD}USAGE${RESET}
  sslcheck <domain> [domain2...]
  sslcheck --file domains.txt
  ssl-cert-check github.com api.github.com:8443

${BOLD}OPTIONS${RESET}
  -f, --file <path>       Read domains from a newline-separated file
  -w, --warn-days <n>     Days threshold for warning (default: 30)
      --format <fmt>      Output format: table (default), json, csv
      --chain             Show full certificate chain
      --timeout <sec>     Per-domain timeout in seconds (default: 10)
  -h, --help              Show this help

${BOLD}EXIT CODES${RESET}
  0  All certs valid and beyond warn-days threshold
  1  One or more certs expire within warn-days, are expired, or errored

${BOLD}EXAMPLES${RESET}
  sslcheck github.com google.com
  sslcheck --file domains.txt --warn-days 14
  sslcheck example.com --format json
  sslcheck example.com:8443 --chain
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Load domains from file
  if (opts.file) {
    try {
      const raw = readFileSync(opts.file, 'utf8');
      const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      opts.domains.push(...lines);
    } catch (err) {
      console.error(`${RED}Error reading file "${opts.file}": ${err.message}${RESET}`);
      process.exit(1);
    }
  }

  if (opts.domains.length === 0) {
    printHelp();
    process.exit(1);
  }

  // Deduplicate
  const unique = [...new Set(opts.domains)];
  const parsed = unique.map(parseDomainArg);

  // Parallel checks
  const results = await Promise.all(
    parsed.map(({ host, port }) => checkCert(host, port, opts.chain, opts.timeout))
  );

  // Output
  if (opts.format === 'json') {
    printJson(results);
  } else if (opts.format === 'csv') {
    printCsv(results);
  } else {
    printTable(results, opts.warnDays);
  }

  // Exit code: 1 if any cert is expired, within warn window, or errored
  const shouldWarn = results.some(r => r.error || r.daysLeft < 0 || r.daysLeft <= opts.warnDays);
  process.exit(shouldWarn ? 1 : 0);
}

main().catch(err => {
  console.error(`${RED}Fatal: ${err.message}${RESET}`);
  process.exit(1);
});
