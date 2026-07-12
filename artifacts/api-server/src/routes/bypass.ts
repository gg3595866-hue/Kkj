import { Router } from "express";
import { fetch as undiciFetch, Agent } from "undici";
import * as dns from "dns/promises";
import * as net from "net";

const bypassRouter = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildInsecureAgent(ip?: string) {
  return new Agent({
    connect: {
      rejectUnauthorized: false,
      // When connecting to a raw IP we still need SNI so TLS handshake works
      ...(ip ? { servername: ip } : {}),
    },
  });
}

/** Try a TCP connect to host:port, return latency or null on timeout */
function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    const cleanup = (result: number | null) => {
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(timeoutMs);
    sock.connect(port, host, () => cleanup(Date.now() - t0));
    sock.on("timeout", () => cleanup(null));
    sock.on("error", () => cleanup(null));
  });
}

/** Send one HTTP/HTTPS request to a specific IP with a spoofed Host header */
async function httpProbeIp(
  ip: string,
  port: number,
  scheme: "http" | "https",
  originalUrl: URL,
  extraHeaders: Record<string, string>,
  body: string | undefined,
  method: string
): Promise<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  error: null | string;
}> {
  const t0 = Date.now();
  const targetUrl = `${scheme}://${ip}:${port}${originalUrl.pathname}${originalUrl.search}`;
  try {
    const agent = new Agent({ connect: { rejectUnauthorized: false, servername: originalUrl.hostname } });
    const opts: RequestInit & { dispatcher?: unknown } = {
      method,
      headers: {
        Host: originalUrl.host,          // ← pretend we're hitting the real domain
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Connection: "keep-alive",
        ...extraHeaders,
      },
      dispatcher: agent,
      signal: AbortSignal.timeout(8_000),
    };
    if (body && !["GET", "HEAD"].includes(method.toUpperCase())) {
      opts.body = body;
      (opts.headers as Record<string, string>)["Content-Type"] =
        extraHeaders["content-type"] ?? extraHeaders["Content-Type"] ?? "application/json";
    }
    const resp = await undiciFetch(targetUrl, opts as RequestInit);
    const durationMs = Date.now() - t0;
    const respHeaders: Record<string, string> = {};
    resp.headers.forEach((v, k) => { respHeaders[k] = v; });
    const text = await resp.text();
    return {
      status: resp.status,
      statusText: resp.statusText || String(resp.status),
      headers: respHeaders,
      body: text.length > 6_000 ? text.slice(0, 6_000) + "\n…(truncated)" : text,
      durationMs,
      error: null,
    };
  } catch (err: unknown) {
    return {
      status: 0,
      statusText: "Error",
      headers: {},
      body: "",
      durationMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── route ────────────────────────────────────────────────────────────────────
// POST /api/proxy/bypass
//
// Techniques:
//   dns        — resolve all A/AAAA records for the hostname
//   portscan   — TCP-probe the resolved IPs on a list of common backend ports
//   directip   — send the real request to each reachable IP:port with spoofed Host
//   hostswap   — try alternative subdomains / Host values against the original URL

bypassRouter.post("/proxy/bypass", async (req, res) => {
  const {
    url,
    method = "POST",
    headers: customHeaders = {},
    bearerToken,
    authHeaderName,
    body,
    techniques = ["dns", "portscan", "directip"],
    extraPorts = [],
  } = req.body;

  if (!url) {
    res.status(400).json({ error: "url is required" });
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).json({ error: `Invalid URL: "${url}"` });
    return;
  }

  const hostname = parsed.hostname;
  const scheme = parsed.protocol.replace(":", "") as "http" | "https";
  const defaultPort = scheme === "https" ? 443 : 80;

  // Auth header
  const authHeaders: Record<string, string> = { ...customHeaders };
  if (bearerToken) {
    const name = (authHeaderName && authHeaderName.trim()) ? authHeaderName.trim() : "Authorization";
    authHeaders[name] = `Bearer ${bearerToken}`;
  }

  const output: Record<string, unknown> = {};

  // ── 1. DNS ──────────────────────────────────────────────────────────────────
  let resolvedIps: string[] = [];
  if (techniques.includes("dns")) {
    try {
      const [v4, v6] = await Promise.allSettled([
        dns.resolve4(hostname),
        dns.resolve6(hostname),
      ]);
      const ips4 = v4.status === "fulfilled" ? v4.value : [];
      const ips6 = v6.status === "fulfilled" ? v6.value : [];
      resolvedIps = [...ips4, ...ips6];

      // Also grab CNAME chain and NS to fingerprint CDN / proxy
      const [cname, ns, mx] = await Promise.allSettled([
        dns.resolveCname(hostname),
        dns.resolveNs(hostname),
        dns.resolveMx(hostname),
      ]);

      output.dns = {
        hostname,
        ipv4: ips4,
        ipv6: ips6,
        cname: cname.status === "fulfilled" ? cname.value : [],
        ns: ns.status === "fulfilled" ? ns.value : [],
        mx: mx.status === "fulfilled" ? mx.value : [],
        proxyFingerprint: fingerprintDns(
          ips4,
          cname.status === "fulfilled" ? cname.value : [],
          ns.status === "fulfilled" ? ns.value : []
        ),
      };
    } catch (err: unknown) {
      output.dns = { error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    // Still need IPs for later stages
    try {
      resolvedIps = await dns.resolve4(hostname);
    } catch {
      /* ignore */
    }
  }

  // ── 2. Port scan ─────────────────────────────────────────────────────────────
  const BACKEND_PORTS = [
    80, 443, 8080, 8443, 3000, 3001, 4000, 4001, 5000, 5001,
    8000, 8001, 8888, 9000, 9001, 9090, 9443, 10000, 1337,
    ...extraPorts,
  ];

  const openPortsByIp: Record<string, { port: number; latencyMs: number }[]> = {};

  if (techniques.includes("portscan") && resolvedIps.length > 0) {
    await Promise.all(
      resolvedIps.map(async (ip) => {
        const results = await Promise.all(
          BACKEND_PORTS.map(async (port) => {
            const latency = await tcpProbe(ip, port, 2500);
            return latency !== null ? { port, latencyMs: latency } : null;
          })
        );
        openPortsByIp[ip] = results.filter(Boolean) as { port: number; latencyMs: number }[];
      })
    );
    output.portscan = {
      scannedPorts: BACKEND_PORTS,
      results: openPortsByIp,
      note: "Ports listed are TCP-open (connection accepted); the proxy may still be answering on most of these.",
    };
  }

  // ── 3. Direct IP HTTP probe ───────────────────────────────────────────────────
  if (techniques.includes("directip") && resolvedIps.length > 0) {
    // Only hit ports that are actually open; fall back to default port if none found
    const probeTargets: { ip: string; port: number; scheme: "http" | "https" }[] = [];

    for (const ip of resolvedIps) {
      const open = openPortsByIp[ip] ?? [];
      if (open.length === 0) {
        probeTargets.push({ ip, port: defaultPort, scheme });
      } else {
        for (const { port } of open) {
          probeTargets.push({
            ip,
            port,
            scheme: port === 443 || port === 8443 || port === 9443 ? "https" : "http",
          });
        }
      }
    }

    // Cap at 12 targets to avoid explosion
    const capped = probeTargets.slice(0, 12);

    const directResults = await Promise.all(
      capped.map(async ({ ip, port, scheme: s }) => {
        const result = await httpProbeIp(ip, port, s, parsed, authHeaders, body, method);
        return {
          target: `${s}://${ip}:${port}`,
          ...result,
          backendFingerprint: fingerprintResponse(result.headers),
        };
      })
    );

    output.directip = {
      note: "Requests sent to raw IPs with original Host header — bypasses DNS-based routing",
      results: directResults,
    };
  }

  // ── 4. Host swap ─────────────────────────────────────────────────────────────
  // Try alternative Host values that might route past the Angie proxy to the backend
  if (techniques.includes("hostswap")) {
    const parts = hostname.split(".");
    const domain = parts.slice(-2).join(".");
    const sub = parts.slice(0, -2).join(".");

    const hostCandidates = [
      `backend.${domain}`,
      `api.${domain}`,
      `internal.${domain}`,
      `app.${domain}`,
      `games.${domain}`,
      `service.${domain}`,
      `${sub}.internal.${domain}`,
      `127.0.0.1`,
      `localhost`,
      domain,                         // apex — bypasses subdomain proxy
    ];

    const agent = buildInsecureAgent();
    const swapResults = await Promise.all(
      hostCandidates.map(async (altHost) => {
        const t0 = Date.now();
        try {
          const resp = await undiciFetch(url, {
            method,
            headers: {
              ...authHeaders,
              Host: altHost,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/json, text/plain, */*",
            },
            // @ts-expect-error undici dispatcher
            dispatcher: agent,
            signal: AbortSignal.timeout(6_000),
            ...(body && !["GET", "HEAD"].includes(method.toUpperCase())
              ? { body, headers: { ...authHeaders, Host: altHost, "Content-Type": "application/json" } }
              : {}),
          });
          const durationMs = Date.now() - t0;
          const hdrs: Record<string, string> = {};
          resp.headers.forEach((v, k) => { hdrs[k] = v; });
          const text = await resp.text();
          return {
            altHost,
            status: resp.status,
            statusText: resp.statusText,
            durationMs,
            headers: hdrs,
            body: text.slice(0, 2_000),
            error: null,
          };
        } catch (err: unknown) {
          return {
            altHost,
            status: 0,
            statusText: "Error",
            durationMs: Date.now() - t0,
            headers: {},
            body: "",
            error: err instanceof Error ? err.message : String(err),
          };
        }
      })
    );
    output.hostswap = {
      note: "Same URL but with a different Host header — some proxies route based on Host to different upstreams",
      results: swapResults,
    };
  }

  res.json(output);
});

// ─── fingerprinting helpers ───────────────────────────────────────────────────

function fingerprintDns(ips: string[], cnames: string[], ns: string[]): string {
  const hints: string[] = [];
  const allText = [...ips, ...cnames, ...ns].join(" ").toLowerCase();
  if (allText.includes("cloudflare")) hints.push("Cloudflare CDN");
  if (allText.includes("akamai")) hints.push("Akamai CDN");
  if (allText.includes("fastly")) hints.push("Fastly CDN");
  if (allText.includes("amazonaws") || allText.includes("aws")) hints.push("AWS");
  if (allText.includes("1xbet") || allText.includes("1x-bet")) hints.push("1xBet own infrastructure");
  if (cnames.length > 0) hints.push(`CNAME chain (${cnames.length} hop${cnames.length > 1 ? "s" : ""})`);
  return hints.length > 0 ? hints.join(", ") : "No well-known proxy/CDN detected in DNS";
}

function fingerprintResponse(headers: Record<string, string>): string {
  const hints: string[] = [];
  const server = (headers["server"] ?? "").toLowerCase();
  const via = (headers["via"] ?? "").toLowerCase();
  const xpowered = headers["x-powered-by"] ?? "";
  const xproxy = headers["x-proxy-id"] ?? headers["x-angie-upstream"] ?? headers["x-cache"] ?? "";

  if (server.includes("angie")) hints.push("Angie proxy confirmed in Server header");
  if (server.includes("nginx")) hints.push("nginx (may be Angie)");
  if (server.includes("apache")) hints.push("Apache httpd");
  if (server.includes("node") || xpowered.toLowerCase().includes("express")) hints.push("Node.js/Express backend");
  if (server.includes("openresty")) hints.push("OpenResty (nginx + Lua)");
  if (via) hints.push(`Via: ${via}`);
  if (xproxy) hints.push(`Proxy header: ${xproxy}`);
  if (xpowered) hints.push(`X-Powered-By: ${xpowered}`);
  if (hints.length === 0 && server) hints.push(`Server: ${server}`);
  return hints.length > 0 ? hints.join(" | ") : "No fingerprint data in response headers";
}

export default bypassRouter;
