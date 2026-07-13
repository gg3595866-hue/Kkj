import { Router } from "express";
import { fetch as undiciFetch, Agent } from "undici";
import * as dns from "node:dns/promises";

const reconRouter = Router();

const httpAgent = new Agent({ connect: { rejectUnauthorized: false } });

// ─── Cloudflare IP ranges (IPv4 CIDR) ────────────────────────────────────────
// Source: https://www.cloudflare.com/ips-v4
const CF_RANGES_V4 = [
  "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "104.16.0.0/13",   "104.24.0.0/14",   "108.162.192.0/18",
  "131.0.72.0/22",   "141.101.64.0/18", "162.158.0.0/15",
  "172.64.0.0/13",   "173.245.48.0/20", "188.114.96.0/20",
  "190.93.240.0/20", "197.234.240.0/22","198.41.128.0/17",
];

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
}

function cidrContains(cidr: string, ip: string): boolean {
  const [range, bits] = cidr.split("/");
  const mask = bits ? ~((1 << (32 - parseInt(bits))) - 1) >>> 0 : 0xffffffff;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

function isCloudflareIp(ip: string): boolean {
  if (!ip || ip.includes(":")) return false; // skip IPv6
  return CF_RANGES_V4.some(cidr => cidrContains(cidr, ip));
}

// ─── Subdomain wordlist (hand-picked most-forgotten dev/admin subs) ───────────
const SUBDOMAIN_WORDLIST = [
  "www","mail","ftp","remote","blog","webmail","server","ns1","ns2","smtp","secure","vpn","m","shop",
  "mx","mail2","upload","download","api","dev","staging","test","beta","demo","portal","admin","status",
  "app","cdn","img","images","media","static","assets","support","help","docs","wiki","forum",
  "store","old","new","back","backup","direct","origin","real","live","prod","production",
  "git","gitlab","github","jira","jenkins","ci","deploy","internal","intranet","extranet",
  "management","panel","cpanel","whm","plesk","ftp2","sftp","ssh","rdp","vnc","proxy","gateway",
  "lb","load","balancer","f5","ha","redis","memcache","mysql","db","database","postgres","mongo",
  "elastic","kibana","grafana","prometheus","logstash","zabbix","nagios","monitoring","log","logs",
  "devops","ops","infra","infrastructure","cloud","aws","gcp","azure","k8s","kube","rancher",
  "mobile","api2","v2","v1","v3","services","microservice","rpc","grpc","soap","rest","graphql",
  "auth","login","sso","oauth","idp","identity","accounts","account","user","users","profile",
  "payment","pay","checkout","billing","invoice","finance","stripe","paypal","braintree",
  "game","games","play","server1","server2","game1","game2","socket","ws","wss","feed",
  "stream","video","live","rtmp","hls","push","pull","edge","relay","broker","queue","mq",
  "exchange","kafka","rabbit","nats","pubsub","event","events","webhook","notify","notification",
  "analytics","tracker","metrics","stats","report","reporting","data","warehouse","etl",
  "error","exception","trace","debug","health","ping","heartbeat","status2","uptime",
  "sandbox","qa","uat","dev2","test2","rc","release","canary","preview","feature",
  "partner","b2b","wholesale","reseller","affiliate","agent","broker2","dealer",
  "mail3","smtp2","imap","pop","pop3","calendar","meet","conference","webex","zoom",
  "crm","erp","pos","epos","retail","back-office","backoffice","hr","hr-portal",
  "upload2","cdn2","assets2","storage","s3","files","file","dl","download2",
  "uat","preprod","pre-prod","staging2","stg","stg2","dr","disaster","failover",
  "mx1","mx2","relay","mailserver","spam","antispam","filter","forward",
  "ns3","ns4","dns","dns1","dns2","resolver","ddns",
  "mobi","wap","touch","ios","android","mobileapi",
  "corporate","company","business","enterprise",
].filter((v, i, a) => a.indexOf(v) === i); // dedupe

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function tryFetch(url: string, opts: any = {}, timeoutMs = 10_000): Promise<{ ok: boolean; text: string; status: number }> {
  try {
    const resp = await undiciFetch(url, {
      ...opts,
      // @ts-expect-error undici dispatcher
      dispatcher: httpAgent,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const text = await resp.text().catch(() => "");
    return { ok: resp.ok, text, status: resp.status };
  } catch {
    return { ok: false, text: "", status: 0 };
  }
}

// ─── Phase 1: DNS resolution + Cloudflare check ───────────────────────────────
async function phase1Dns(domain: string) {
  const findings: string[] = [];
  const ips: { ip: string; isCloudflare: boolean; source: string }[] = [];

  // A records
  try {
    const aRecords = await dns.resolve4(domain).catch(() => [] as string[]);
    for (const ip of aRecords) {
      const cf = isCloudflareIp(ip);
      ips.push({ ip, isCloudflare: cf, source: "A record" });
      if (!cf) findings.push(`Non-CF A record: ${ip}`);
    }
  } catch { /* ignore */ }

  // MX records (sometimes leak origin IP)
  try {
    const mxRecords = await dns.resolveMx(domain).catch(() => [] as dns.MxRecord[]);
    for (const mx of mxRecords) {
      const mxIps = await dns.resolve4(mx.exchange).catch(() => [] as string[]);
      for (const ip of mxIps) {
        const cf = isCloudflareIp(ip);
        ips.push({ ip, isCloudflare: cf, source: `MX: ${mx.exchange}` });
        if (!cf) findings.push(`Non-CF MX IP: ${ip} (${mx.exchange})`);
      }
    }
  } catch { /* ignore */ }

  // TXT records (sometimes contain server hints)
  let txtRecords: string[][] = [];
  try { txtRecords = await dns.resolveTxt(domain).catch(() => [] as string[][]); } catch { /* ignore */ }

  const behindCf = ips.length > 0 && ips.every(i => i.isCloudflare);
  const hasDirectIp = ips.some(i => !i.isCloudflare);

  return { ips, txtRecords: txtRecords.flat(), behindCf, hasDirectIp, findings };
}

// ─── Phase 2: Crimeflare database lookup ─────────────────────────────────────
async function phase2Crimeflare(domain: string) {
  const results: { source: string; ip: string; evidence: string }[] = [];

  // Crimeflare direct lookup
  try {
    const r = await tryFetch("http://www.crimeflare.org:82/cfs.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `cfS=${encodeURIComponent(domain)}`,
    }, 15_000);
    if (r.ok && r.text) {
      // Response format: "RESULTS\n<domain> : <ip>\n" or similar
      const ipMatches = r.text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
      for (const ip of [...new Set(ipMatches)]) {
        if (!isCloudflareIp(ip) && ip !== "0.0.0.0") {
          results.push({ source: "crimeflare.org DB", ip, evidence: r.text.slice(0, 200) });
        }
      }
    }
  } catch { /* ignore */ }

  // HackerTarget IP history
  try {
    const r = await tryFetch(`https://api.hackertarget.com/dnslookup/?q=${encodeURIComponent(domain)}`, {}, 10_000);
    if (r.ok && r.text && !r.text.startsWith("error")) {
      const ipMatches = r.text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
      for (const ip of [...new Set(ipMatches)]) {
        if (!isCloudflareIp(ip) && ip !== "0.0.0.0") {
          results.push({ source: "hackertarget.com DNS history", ip, evidence: `DNS history: ${ip}` });
        }
      }
    }
  } catch { /* ignore */ }

  // ViewDNS IP History (scrape public endpoint)
  try {
    const r = await tryFetch(
      `https://viewdns.info/iphistory/?domain=${encodeURIComponent(domain)}`,
      { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36" } },
      10_000
    );
    if (r.ok && r.text) {
      // Extract IPs from HTML table
      const ipMatches = r.text.match(/\b(?:(?!10\.|192\.168\.|172\.1[6-9]\.|172\.2\d\.|172\.3[0-1]\.)(?:\d{1,3}\.){3}\d{1,3})\b/g) ?? [];
      for (const ip of [...new Set(ipMatches)]) {
        if (!isCloudflareIp(ip) && ip !== "0.0.0.0") {
          results.push({ source: "viewdns.info IP history", ip, evidence: `Historical record: ${ip}` });
        }
      }
    }
  } catch { /* ignore */ }

  return results;
}

// ─── Phase 3: Subdomain brute force ──────────────────────────────────────────
async function phase3SubdomainBrute(domain: string, customSubdomains?: string[]) {
  const wordlist = customSubdomains?.length ? customSubdomains : SUBDOMAIN_WORDLIST;
  const hits: { subdomain: string; ips: string[]; nonCfIps: string[]; isCloudflare: boolean }[] = [];

  await mapWithConcurrency(wordlist, 20, async (sub) => {
    const fqdn = `${sub}.${domain}`;
    try {
      const addrs = await dns.resolve4(fqdn);
      if (addrs.length === 0) return;
      const nonCf = addrs.filter(ip => !isCloudflareIp(ip));
      hits.push({
        subdomain: fqdn,
        ips: addrs,
        nonCfIps: nonCf,
        isCloudflare: nonCf.length === 0,
      });
    } catch { /* NXDOMAIN or timeout — not found */ }
  });

  return hits.sort((a, b) => b.nonCfIps.length - a.nonCfIps.length);
}

// ─── Phase 4: HackerTarget subdomain search ───────────────────────────────────
async function phase4HackertargetSubdomains(domain: string) {
  const discovered: { subdomain: string; ips: string[]; nonCfIps: string[] }[] = [];
  try {
    const r = await tryFetch(
      `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(domain)}`,
      {},
      15_000
    );
    if (!r.ok || !r.text || r.text.startsWith("error")) return discovered;

    // Format: "subdomain.example.com,1.2.3.4"
    const lines = r.text.split("\n").filter(Boolean);
    for (const line of lines) {
      const [sub, ip] = line.split(",").map(s => s.trim());
      if (!sub || !ip) continue;
      const nonCf = isCloudflareIp(ip) ? [] : [ip];
      discovered.push({ subdomain: sub, ips: [ip], nonCfIps: nonCf });
    }
  } catch { /* ignore */ }
  return discovered;
}

// ─── Verify an IP is actually the target ─────────────────────────────────────
async function verifyIp(ip: string, domain: string): Promise<{ confirmed: boolean; statusCode: number; serverHeader: string }> {
  // Try HTTPS with Host header matching the domain
  for (const proto of ["https", "http"]) {
    try {
      const resp = await undiciFetch(`${proto}://${ip}`, {
        method: "GET",
        headers: { "Host": domain, "User-Agent": "Mozilla/5.0" },
        // @ts-expect-error undici dispatcher
        dispatcher: httpAgent,
        signal: AbortSignal.timeout(8_000),
        redirect: "manual",
      });
      const serverHeader = resp.headers.get("server") ?? "";
      // If we get any non-error response, it's likely the right server
      return { confirmed: resp.status < 500, statusCode: resp.status, serverHeader };
    } catch { /* try next proto */ }
  }
  return { confirmed: false, statusCode: 0, serverHeader: "" };
}

// ─── Route ────────────────────────────────────────────────────────────────────
reconRouter.post("/api/recon/cloudfail", async (req, res) => {
  const { target, customSubdomains } = req.body as { target?: string; customSubdomains?: string[] };

  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "target domain is required" });
    return;
  }

  // Strip protocol, path, port — extract bare domain
  let domain = target.trim().toLowerCase();
  try { domain = new URL(domain.startsWith("http") ? domain : `https://${domain}`).hostname; } catch { /* use as-is */ }
  domain = domain.replace(/^www\./, "");

  const startTime = Date.now();

  // Run phases 1-4 in parallel
  const [phase1, phase2Results, phase4Subdomains] = await Promise.all([
    phase1Dns(domain),
    phase2Crimeflare(domain),
    phase4HackertargetSubdomains(domain),
  ]);

  // Phase 3 runs with the full wordlist (can be slow — cap at 20 concurrent)
  const phase3Subdomains = await phase3SubdomainBrute(domain, customSubdomains);

  // Merge subdomain results from phase 3 and phase 4
  const allSubdomains = [...phase3Subdomains];
  for (const s of phase4Subdomains) {
    if (!allSubdomains.some(e => e.subdomain === s.subdomain)) {
      allSubdomains.push(s);
    }
  }
  allSubdomains.sort((a, b) => b.nonCfIps.length - a.nonCfIps.length);

  // Collect all non-Cloudflare IPs found
  const candidateIpSet = new Set<string>();
  for (const e of phase1.ips) { if (!e.isCloudflare) candidateIpSet.add(e.ip); }
  for (const e of phase2Results) { candidateIpSet.add(e.ip); }
  for (const s of allSubdomains) { s.nonCfIps.forEach(ip => candidateIpSet.add(ip)); }

  // Verify top candidate IPs (cap at 5 to stay fast)
  const candidateIps = [...candidateIpSet].slice(0, 5);
  const verifications = await Promise.all(
    candidateIps.map(async ip => ({ ip, ...await verifyIp(ip, domain) }))
  );

  res.json({
    domain,
    durationMs: Date.now() - startTime,
    behindCloudflare: phase1.behindCf,
    hasDirectIp: phase1.hasDirectIp || candidateIpSet.size > 0,
    phase1: {
      ips: phase1.ips,
      txtRecords: phase1.txtRecords,
      behindCf: phase1.behindCf,
      findings: phase1.findings,
    },
    phase2: phase2Results,
    phase3: {
      totalProbed: (customSubdomains?.length ?? SUBDOMAIN_WORDLIST.length),
      found: allSubdomains.length,
      subdomains: allSubdomains,
    },
    candidateIps: verifications,
  });
});

export default reconRouter;
