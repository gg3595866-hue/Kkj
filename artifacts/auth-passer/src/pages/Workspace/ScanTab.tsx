import React, { useState, useEffect } from 'react';
import { AppRequestState } from './types';
import { Button, Input, Textarea } from '@/components/ui/core';
import { useScanEndpoints } from '@workspace/api-client-react';
import { Play, ListPlus, Target } from 'lucide-react';
import { ADMIN_PATH_WORDLIST, GAME_API_WORDLIST } from './adminWordlist';

// Endpoint / admin-surface discovery. If the normal client-facing endpoint
// doesn't cooperate (blocked, rate-limited, wrong shape), this scans a base
// URL against a wordlist of candidate paths — admin backoffice routes by
// default — so a discovered path can be routed into as the request target
// instead.
export function ScanTab({ request, setRequest, setResponse, onRouteThrough, reconTarget }: {
  request: AppRequestState;
  setRequest: React.Dispatch<React.SetStateAction<AppRequestState>>;
  setResponse: (res: any) => void;
  onRouteThrough: (url: string) => void;
  reconTarget?: { ip: string; domain: string; nonce: number } | null;
}) {
  const scanEndpoints = useScanEndpoints();

  const deriveBaseUrl = (fromUrl?: string) => {
    try {
      const u = new URL(fromUrl ?? request.url);
      // Keep the full path up to (but not including) the last segment.
      // e.g. https://melbet.mobi/games-frame/service-api/games-witch/MakeAction
      //   → https://melbet.mobi/games-frame/service-api/games-witch
      // so wordlist entries like "GetState" probe the same directory as the action.
      const parts = u.pathname.replace(/\/$/, '').split('/');
      parts.pop(); // drop last segment (e.g. "MakeAction")
      const basePath = parts.join('/');
      return `${u.protocol}//${u.host}${basePath}`;
    } catch {
      return '';
    }
  };

  const [baseUrl, setBaseUrl] = useState(deriveBaseUrl());
  const [lastAppliedReconNonce, setLastAppliedReconNonce] = useState<number | null>(null);

  // When Recon routes a confirmed origin IP through, retarget the scan's
  // base URL at that IP directly — same directory structure, minus
  // Cloudflare. The Host header needed to resolve it correctly is already
  // shared via `request.headers` (set by the same Recon action), so the
  // scan's own auth/header wiring below picks it up automatically.
  useEffect(() => {
    if (!reconTarget || reconTarget.nonce === lastAppliedReconNonce) return;
    setLastAppliedReconNonce(reconTarget.nonce);
    setBaseUrl(prevBase => {
      try {
        const u = new URL(prevBase || request.url);
        if (u.hostname === reconTarget.domain || u.hostname.endsWith(`.${reconTarget.domain}`)) {
          const parts = u.pathname.replace(/\/$/, '').split('/');
          parts.pop();
          return `${u.protocol}//${reconTarget.ip}${parts.join('/')}`;
        }
      } catch { /* fall through to root */ }
      return `https://${reconTarget.ip}`;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconTarget]);

  const [pathsStr, setPathsStr] = useState(ADMIN_PATH_WORDLIST.join('\n'));
  const [queryParams, setQueryParams] = useState('');
  const [postBody, setPostBody] = useState('');
  const [scanMethod, setScanMethod] = useState('AUTO');
  const [dualEnabled, setDualEnabled] = useState(false);
  const [backendUrl, setBackendUrl] = useState('');

  const handleLoadAdminWordlist = () => {
    setPathsStr(ADMIN_PATH_WORDLIST.join('\n'));
  };

  const handleLoadGameWordlist = () => {
    setPathsStr(GAME_API_WORDLIST.join('\n'));
  };

  const handleRun = () => {
    const paths = pathsStr
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean);

    if (!baseUrl.trim() || paths.length === 0) return;

    const headersRecord: Record<string, string> = {};
    request.headers.forEach(h => {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
    });

    scanEndpoints.mutate({
      data: {
        baseUrl: baseUrl.trim(),
        paths,
        queryParams: queryParams.trim() || undefined,
        bearerToken: request.bearerToken || undefined,
        authHeaderName: request.authHeaderName || undefined,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        postBody: postBody.trim() || undefined,
        scanMethod,
        ...(dualEnabled && backendUrl.trim() ? { backendUrl: backendUrl.trim() } : {}),
      } as any
    }, {
      onSuccess: (res) => {
        setResponse({
          results: res,
          _isScan: true,
          baseUrl: baseUrl.trim(),
          queryParams: queryParams.trim(),
          ...(dualEnabled && backendUrl.trim() ? { backendUrl: backendUrl.trim() } : {}),
        });
      },
      onError: (err) => {
        setResponse({ error: err, _isScan: true });
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-4 border-b bg-card shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-muted font-mono text-sm px-2 shrink-0 text-foreground"
            value={scanMethod}
            onChange={e => setScanMethod(e.target.value)}
            title="HTTP method for each path probe"
          >
            <option value="AUTO">AUTO</option>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="HEAD">HEAD</option>
            <option value="OPTIONS">OPTIONS</option>
            <option value="PATCH">PATCH</option>
          </select>
          <Input
            className="flex-1 font-mono text-sm"
            placeholder="https://api.example.com"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRun()}
          />
          <Button onClick={handleRun} disabled={scanEndpoints.isPending || !baseUrl.trim() || !pathsStr.trim()} className="shrink-0 w-32">
            {scanEndpoints.isPending ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <><Play className="w-4 h-4 mr-1" /> Run Scan</>}
          </Button>
        </div>
        {reconTarget && lastAppliedReconNonce === reconTarget.nonce && (
          <div className="flex items-center gap-1.5 text-[11px] text-green-400 font-mono -mt-1">
            <Target className="w-3 h-3" />
            Targeting origin {reconTarget.ip} directly (Host: {reconTarget.domain}) — Cloudflare bypassed
          </div>
        )}
        {/* Dual-target toggle */}
        <div className="flex items-start gap-3 pt-1">
          <button
            onClick={() => setDualEnabled(v => !v)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none mt-0.5 ${dualEnabled ? 'bg-primary' : 'bg-muted'}`}
            role="switch"
            aria-checked={dualEnabled}
            title="Compare client API vs backend/internal server"
          >
            <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${dualEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
          <div className="flex-1 space-y-1.5">
            <div className="text-xs font-medium text-foreground leading-tight">
              Compare vs Backend / Internal Server
            </div>
            <div className="text-xs text-muted-foreground leading-snug">
              Each path scanned against <span className="text-foreground">both</span> the client API URL and your backend URL simultaneously.
              Mismatches (different status codes, one has data the other doesn't) are highlighted — these reveal what middleware is hiding.
            </div>
            {dualEnabled && (
              <Input
                className="font-mono text-sm mt-1"
                placeholder="https://internal.melbet.mobi/game-backend"
                value={backendUrl}
                onChange={e => setBackendUrl(e.target.value)}
              />
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">AUTO</span> = GET first, then POST if nothing useful returns.
          Select a specific method to force all probes to use that method only. Uses the same auth as Builder/Probe tabs.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-2 flex-1 flex flex-col min-h-[220px]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Candidate Paths (one per line)</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={handleLoadAdminWordlist}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                title="Reset to the default admin-path wordlist"
              >
                <ListPlus className="w-3 h-3" /> Admin wordlist
              </button>
              <button
                onClick={handleLoadGameWordlist}
                className="flex items-center gap-1 text-xs text-green-400 hover:underline"
                title="Load game-engine state query paths (GetState, GetGame, GetInfo, …)"
              >
                <ListPlus className="w-3 h-3" /> Game API wordlist
              </button>
            </div>
          </div>
          <Textarea
            className="flex-1 font-mono text-xs resize-none min-h-[220px]"
            placeholder={'admin\napi/admin\ninternal-api'}
            value={pathsStr}
            onChange={e => setPathsStr(e.target.value)}
          />
          <div className="text-xs text-muted-foreground">{pathsStr.split('\n').map(p => p.trim()).filter(Boolean).length} paths</div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Query String (optional)</h3>
          <Input
            className="font-mono text-sm"
            placeholder="language=en&whence=114"
            value={queryParams}
            onChange={e => setQueryParams(e.target.value)}
          />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Authentication</h3>
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0">
              <Input
                list="auth-header-names-scan"
                placeholder="Header Name"
                className="font-mono text-sm bg-muted text-muted-foreground h-9"
                value={request.authHeaderName}
                onChange={e => setRequest({...request, authHeaderName: e.target.value})}
                title="Auth Header Name"
              />
              <datalist id="auth-header-names-scan">
                <option value="Authorization" />
                <option value="x-auth" />
                <option value="X-API-Key" />
                <option value="X-Token" />
              </datalist>
            </div>
            <Input
              type="password"
              placeholder="Bearer Token (e.g. eyJhbGci...)"
              value={request.bearerToken}
              onChange={e => setRequest({...request, bearerToken: e.target.value})}
            />
          </div>
        </section>

        <section className="space-y-2 flex-1 flex flex-col min-h-[140px]">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">POST Body (optional, tried if GET returns nothing useful)</h3>
          <Textarea
            className="flex-1 font-mono text-xs resize-none"
            placeholder={'{\n  "key": "value"\n}'}
            value={postBody}
            onChange={e => setPostBody(e.target.value)}
          />
        </section>
      </div>
    </div>
  );
}
