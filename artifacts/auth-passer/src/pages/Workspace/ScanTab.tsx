import React, { useState } from 'react';
import { AppRequestState } from './types';
import { Button, Input, Textarea } from '@/components/ui/core';
import { useScanEndpoints } from '@workspace/api-client-react';
import { Play, ListPlus } from 'lucide-react';
import { ADMIN_PATH_WORDLIST } from './adminWordlist';

// Endpoint / admin-surface discovery. If the normal client-facing endpoint
// doesn't cooperate (blocked, rate-limited, wrong shape), this scans a base
// URL against a wordlist of candidate paths — admin backoffice routes by
// default — so a discovered path can be routed into as the request target
// instead.
export function ScanTab({ request, setRequest, setResponse, onRouteThrough }: {
  request: AppRequestState;
  setRequest: React.Dispatch<React.SetStateAction<AppRequestState>>;
  setResponse: (res: any) => void;
  onRouteThrough: (url: string) => void;
}) {
  const scanEndpoints = useScanEndpoints();

  const deriveBaseUrl = () => {
    try {
      const u = new URL(request.url);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  };

  const [baseUrl, setBaseUrl] = useState(deriveBaseUrl());
  const [pathsStr, setPathsStr] = useState(ADMIN_PATH_WORDLIST.join('\n'));
  const [queryParams, setQueryParams] = useState('');
  const [postBody, setPostBody] = useState('');

  const handleLoadAdminWordlist = () => {
    setPathsStr(ADMIN_PATH_WORDLIST.join('\n'));
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
      }
    }, {
      onSuccess: (res) => {
        setResponse({ results: res, _isScan: true, baseUrl: baseUrl.trim(), queryParams: queryParams.trim() });
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
        <div className="text-xs text-muted-foreground">
          Probes each path below with GET (then POST if nothing useful comes back) against the base URL, using the same auth as the Builder/Probe tabs. Useful for finding an admin/internal endpoint to route requests through when the normal client-side route doesn't work.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-2 flex-1 flex flex-col min-h-[220px]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Candidate Paths (one per line)</h3>
            <button
              onClick={handleLoadAdminWordlist}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
              title="Reset to the default admin-path wordlist"
            >
              <ListPlus className="w-3 h-3" /> Load admin wordlist
            </button>
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
