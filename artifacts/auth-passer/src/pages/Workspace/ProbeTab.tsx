import React, { useState, useMemo } from 'react';
import { AppRequestState } from './types';
import { Button, Input, Textarea } from '@/components/ui/core';
import { useProbeRequest, ProxyRequestInputMethod } from '@workspace/api-client-react';
import { Play, ChevronDown, ChevronRight } from 'lucide-react';

function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null {
  try {
    const parts = token.trim().split('.');
    if (parts.length < 2) return null;
    const decode = (b64: string) => JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
    return { header: decode(parts[0]), payload: decode(parts[1]) };
  } catch {
    return null;
  }
}

function JwtDecoder({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const decoded = useMemo(() => decodeJwt(token), [token]);
  if (!token || !decoded) return null;
  const exp = decoded.payload['exp'];
  const expDate = typeof exp === 'number' ? new Date(exp * 1000).toLocaleString() : null;
  const expired = typeof exp === 'number' && exp * 1000 < Date.now();
  return (
    <div className="border border-border/40 rounded-md bg-muted/5 overflow-hidden text-xs font-mono">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/10 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="text-muted-foreground">JWT claims</span>
        {expDate && (
          <span className={`ml-auto text-[10px] ${expired ? 'text-destructive' : 'text-green-400'}`}>
            {expired ? '✗ expired' : '✓ valid'} · exp {expDate}
          </span>
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Header</div>
            <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-all text-foreground/80">
              {JSON.stringify(decoded.header, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Payload</div>
            <pre className="text-[10px] leading-relaxed whitespace-pre-wrap break-all text-foreground/80">
              {JSON.stringify(decoded.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

export function ProbeTab({ request, setRequest, setResponse }: { request: AppRequestState, setRequest: React.Dispatch<React.SetStateAction<AppRequestState>>, setResponse: (res: any) => void }) {
  const probeRequest = useProbeRequest();
  
  const [techniques, setTechniques] = useState({
    timing: false,
    partial: false,
    expect100: false,
    race: false,
    cross: false,
    methodprobe: false,
    validationprobe: false,
    replay: false,
    idprobe: false,
    surrogateprobe: false,
    jwtprobe: false,
  });
  const [idBodyField, setIdBodyField] = useState('UI');
  const [idCustomValues, setIdCustomValues] = useState('');

  // JWT tamper probe state
  const [jwtUiField, setJwtUiField] = useState('UI');
  const [jwtFakeUserId, setJwtFakeUserId] = useState('99999999');

  // Surrogate probe state
  const [surrogateUiField, setSurrogateUiField] = useState('UI');
  const [surrogateUiValues, setSurrogateUiValues] = useState('99999999\n88888888');
  const [surrogateRounds, setSurrogateRounds] = useState(1);
  const [surrogateIncludeControl, setSurrogateIncludeControl] = useState(true);
  
  const [timingRounds, setTimingRounds] = useState(5);
  const [raceConnections, setRaceConnections] = useState(10);
  const [crossRounds, setCrossRounds] = useState(6);
  const [replayRounds, setReplayRounds] = useState(4);

  // Validation probe state
  const DEFAULT_PATCHES = [
    '{"AN":-1}',
    '{"AN":999999}',
    '{"GT":0}',
    '{"UC":0}',
  ];
  const [validationPatches, setValidationPatches] = useState(DEFAULT_PATCHES.join('\n'));

  // Site B state (for cross technique)
  const [siteBUrl, setSiteBUrl] = useState('');
  const [siteBMethod, setSiteBMethod] = useState<ProxyRequestInputMethod>('POST');
  const [siteBToken, setSiteBToken] = useState('');
  const [siteBAuthHeader, setSiteBAuthHeader] = useState('x-auth');
  const [siteBBody, setSiteBBody] = useState('');

  const handleRun = () => {
    const selectedTechniques = Object.entries(techniques)
      .filter(([_, v]) => v)
      .map(([k]) => k as "timing" | "partial" | "expect100" | "race" | "cross" | "methodprobe" | "validationprobe" | "replay" | "idprobe" | "surrogateprobe" | "jwtprobe");
      
    if (selectedTechniques.length === 0) return;

    const headersRecord: Record<string, string> = {};
    request.headers.forEach(h => {
      if (h.key.trim()) headersRecord[h.key.trim()] = h.value;
    });

    probeRequest.mutate({
      data: {
        url: request.url,
        method: request.method,
        headers: Object.keys(headersRecord).length > 0 ? headersRecord : undefined,
        bearerToken: request.bearerToken || undefined,
        authHeaderName: request.authHeaderName || undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? request.body : undefined,
        techniques: selectedTechniques,
        timingRounds: techniques.timing ? timingRounds : undefined,
        raceConnections: techniques.race ? raceConnections : undefined,
        // Cross technique fields
        ...(techniques.cross ? {
          crossRounds,
          siteBUrl: siteBUrl || undefined,
          siteBMethod: siteBMethod || undefined,
          siteBBearerToken: siteBToken || undefined,
          siteBAuthHeaderName: siteBAuthHeader || undefined,
          siteBBody: siteBBody || undefined,
        } : {}),
        // Replay probe fields
        ...(techniques.replay ? { replayRounds } : {}),
        // Validation probe fields
        ...(techniques.validationprobe ? {
          validationPatches: validationPatches
            .split('\n')
            .map(p => p.trim())
            .filter(Boolean),
        } : {}),
        // Identity mismatch probe
        ...(techniques.idprobe ? {
          idBodyField: idBodyField.trim() || 'UI',
          idExtraValues: idCustomValues
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
            .map(s => isNaN(Number(s)) ? s : Number(s)),
        } : {}),
        // JWT tamper probe
        ...(techniques.jwtprobe ? {
          jwtUiField: jwtUiField.trim() || 'UI',
          jwtFakeUserId: Number(jwtFakeUserId) || 99999999,
        } : {}),
        // Surrogate identity probe
        ...(techniques.surrogateprobe ? {
          surrogateUiField: surrogateUiField.trim() || 'UI',
          surrogateUiValues: surrogateUiValues
            .split('\n')
            .map(s => s.trim())
            .filter(s => s !== '')
            .map(s => Number(s))
            .filter(n => !isNaN(n)),
          surrogateRounds,
          surrogateIncludeControl,
        } : {}),
      }
    }, {
      onSuccess: (res) => {
        setResponse({ ...res, _isProbe: true });
      },
      onError: (err) => {
        setResponse({ error: err, _isProbe: true });
      }
    });
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="p-4 border-b bg-card shrink-0 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <select 
            className="h-9 rounded-md border border-border bg-input px-3 py-1 text-sm text-primary focus:outline-none focus:border-primary font-mono font-bold w-28 shrink-0 appearance-none text-center"
            value={request.method}
            onChange={e => setRequest({...request, method: e.target.value as ProxyRequestInputMethod})}
          >
            {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <Input 
            className="flex-1 font-mono text-sm"
            placeholder="https://melbet.mobi/games-frame/service-api/..."
            value={request.url}
            onChange={e => setRequest({...request, url: e.target.value})}
            onKeyDown={e => e.key === 'Enter' && handleRun()}
          />
          <Button onClick={handleRun} disabled={probeRequest.isPending || Object.values(techniques).every(v => !v)} className="shrink-0 w-32">
            {probeRequest.isPending ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <><Play className="w-4 h-4 mr-1" /> Run Probe</>}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <section className="space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Techniques</h3>
          
          <div className="space-y-3 bg-muted/10 p-3 rounded-md border border-border/50">
            {/* Timing */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.timing}
                onChange={e => setTechniques(prev => ({...prev, timing: e.target.checked}))} />
              <div>
                <div className="text-sm font-medium">Timing</div>
                <div className="text-xs text-muted-foreground">Sends N identical requests and records response time + body. Shows whether the server returns varying content across identical calls.</div>
                {techniques.timing && (
                  <div className="mt-2 flex items-center gap-2" onClick={e => e.preventDefault()}>
                    <span className="text-xs text-muted-foreground">Rounds:</span>
                    <Input type="number" min={1} max={20} value={timingRounds}
                      onChange={e => setTimingRounds(parseInt(e.target.value) || 1)}
                      className="w-20 h-7 text-xs" />
                  </div>
                )}
              </div>
            </label>
            
            {/* Partial */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.partial}
                onChange={e => setTechniques(prev => ({...prev, partial: e.target.checked}))} />
              <div>
                <div className="text-sm font-medium">Partial Read</div>
                <div className="text-xs text-muted-foreground">Sends full request, then aborts TCP read immediately after receiving response status and headers. Stream destroyed after 512 bytes.</div>
              </div>
            </label>
            
            {/* Expect-100 */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.expect100}
                onChange={e => setTechniques(prev => ({...prev, expect100: e.target.checked}))} />
              <div>
                <div className="text-sm font-medium">Expect-100</div>
                <div className="text-xs text-muted-foreground">Sends request headers with Expect: 100-continue but withholds the body.</div>
              </div>
            </label>

            {/* Race */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.race}
                onChange={e => setTechniques(prev => ({...prev, race: e.target.checked}))} />
              <div>
                <div className="text-sm font-medium">Race (single-packet attack)</div>
                <div className="text-xs text-muted-foreground">Opens N raw connections, holds every request one byte short of complete, then releases the final byte on all of them in the same tick.</div>
                {techniques.race && (
                  <div className="mt-2 flex items-center gap-2" onClick={e => e.preventDefault()}>
                    <span className="text-xs text-muted-foreground">Connections:</span>
                    <Input type="number" min={2} max={50} value={raceConnections}
                      onChange={e => setRaceConnections(parseInt(e.target.value) || 2)}
                      className="w-20 h-7 text-xs" />
                  </div>
                )}
              </div>
            </label>

            {/* Replay Probe */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.replay}
                onChange={e => setTechniques(prev => ({...prev, replay: e.target.checked}))} />
              <div>
                <div className="text-sm font-medium">Replay Probe <span className="text-xs font-normal text-yellow-400 ml-1">⚠ round 1 commits, rounds 2+ are safe</span></div>
                <div className="text-xs text-muted-foreground">Sends the same request N times. Round 1 registers the action (unavoidable). Rounds 2–N replay with the same AN — the server should reject them (422) without re-committing. Round 1's response body usually contains the full pre-determined game board (RS field) for all future rows.</div>
                {techniques.replay && (
                  <div className="mt-2 flex items-center gap-2" onClick={e => e.preventDefault()}>
                    <span className="text-xs text-muted-foreground">Total sends:</span>
                    <Input type="number" min={2} max={10} value={replayRounds}
                      onChange={e => setReplayRounds(parseInt(e.target.value) || 2)}
                      className="w-20 h-7 text-xs" />
                    <span className="text-xs text-muted-foreground">1 commit + {replayRounds - 1} replay(s)</span>
                  </div>
                )}
              </div>
            </label>

            {/* Method Probe */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.methodprobe}
                onChange={e => setTechniques(prev => ({...prev, methodprobe: e.target.checked}))} />
              <div>
                <div className="text-sm font-medium">Method Probe <span className="text-xs font-normal text-green-400 ml-1">✓ safe — no side effects</span></div>
                <div className="text-xs text-muted-foreground">Sends OPTIONS, HEAD, and GET to the same URL. Non-mutating methods — reveals what the server allows and how it responds before any body is sent, without registering a game action.</div>
              </div>
            </label>

            {/* Validation Probe */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.validationprobe}
                onChange={e => setTechniques(prev => ({...prev, validationprobe: e.target.checked}))} />
              <div className="flex-1">
                <div className="text-sm font-medium">Validation Probe <span className="text-xs font-normal text-yellow-400 ml-1">⚠ patches that return 2xx may commit</span></div>
                <div className="text-xs text-muted-foreground">Sends the body multiple times with one field patched per round (e.g. AN=-1, GT=0). Requests that fail pre-commit validation reveal server error shapes without registering a real action. One patch per line.</div>
                {techniques.validationprobe && (
                  <div className="mt-2 space-y-1" onClick={e => e.preventDefault()}>
                    <Textarea
                      className="font-mono text-xs resize-none h-24"
                      placeholder={'{"AN":-1}\n{"AN":999999}\n{"GT":0}'}
                      value={validationPatches}
                      onChange={e => setValidationPatches(e.target.value)}
                    />
                    <div className="text-xs text-muted-foreground">
                      {validationPatches.split('\n').map(p => p.trim()).filter(Boolean).length} patches — each JSON object is merged over the base body
                    </div>
                  </div>
                )}
              </div>
            </label>

            {/* Identity Mismatch Probe */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.idprobe}
                onChange={e => setTechniques(prev => ({...prev, idprobe: e.target.checked}))} />
              <div className="flex-1">
                <div className="text-sm font-medium">Identity Mismatch Probe</div>
                <div className="text-xs text-muted-foreground">Tests whether the server validates the body field against the JWT sub claim. Sends 5 hardcoded variants (jwt_id±1, 0, large fake, string) plus any custom IDs you add below.</div>
                {techniques.idprobe && (
                  <div className="mt-2 space-y-2" onClick={e => e.preventDefault()}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Body field:</span>
                      <Input placeholder="UI" value={idBodyField} onChange={e => setIdBodyField(e.target.value)} className="w-24 h-7 text-xs font-mono" />
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground shrink-0 pt-1">Custom IDs to test:</span>
                      <div className="flex-1">
                        <Textarea
                          placeholder={"One value per line, e.g.:\n12345678\nmyDummyAccountId"}
                          value={idCustomValues}
                          onChange={e => setIdCustomValues(e.target.value)}
                          className="font-mono text-xs min-h-[50px]"
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">These will be sent in addition to the 5 hardcoded variants. Numbers or strings both work.</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </label>

            {/* JWT Tamper Probe */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.jwtprobe}
                onChange={e => setTechniques(prev => ({...prev, jwtprobe: e.target.checked}))} />
              <div className="flex-1">
                <div className="text-sm font-medium">JWT Tamper Probe <span className="text-xs font-normal text-yellow-400 ml-1">🔑 tests if server verifies JWT signatures</span></div>
                <div className="text-xs text-muted-foreground mb-1">
                  Takes your real JWT, changes the <code className="bg-muted px-1 rounded text-[10px]">sub</code> to a fake user ID, and sends 5 tampered variants: <code className="bg-muted px-1 rounded text-[10px]">alg:none</code>, stripped sig, original sig on fake payload, HS256/"", HS256/"secret".
                  <span className="block mt-0.5 text-green-400">If any variant gets 2xx → signature is NOT verified → you can probe with any fake identity safely.</span>
                  Also patches the body <code className="bg-muted px-1 rounded text-[10px]">UI</code> field to match the fake ID.
                </div>
                {techniques.jwtprobe && (
                  <div className="mt-2 space-y-2" onClick={e => e.preventDefault()}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Body field:</span>
                      <Input placeholder="UI" value={jwtUiField} onChange={e => setJwtUiField(e.target.value)} className="w-20 h-7 text-xs font-mono" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Fake user ID:</span>
                      <Input placeholder="99999999" value={jwtFakeUserId} onChange={e => setJwtFakeUserId(e.target.value)} className="w-32 h-7 text-xs font-mono" />
                      <span className="text-xs text-muted-foreground">numeric ID to put in both JWT sub and body UI</span>
                    </div>
                  </div>
                )}
              </div>
            </label>

            {/* Surrogate Identity Probe */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.surrogateprobe}
                onChange={e => setTechniques(prev => ({...prev, surrogateprobe: e.target.checked}))} />
              <div className="flex-1">
                <div className="text-sm font-medium">Surrogate Identity Probe <span className="text-xs font-normal text-green-400 ml-1">✓ safe — real account never touched</span></div>
                <div className="text-xs text-muted-foreground mb-1">
                  Exploits the JWT/UI split: your JWT authenticates the call, but a <strong>surrogate (fake) UI</strong> is used as the game-state lookup key. The server processes against the nonexistent surrogate account → 422 safe. Your real account's AN counter is never consumed.
                  <span className="block mt-0.5 text-yellow-400">Tip: use a real dummy/sacrificial account's ID as the surrogate to get richer 2xx responses you can study.</span>
                </div>
                {techniques.surrogateprobe && (
                  <div className="mt-2 space-y-2" onClick={e => e.preventDefault()}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24 shrink-0">Body field:</span>
                      <Input placeholder="UI" value={surrogateUiField} onChange={e => setSurrogateUiField(e.target.value)} className="w-20 h-7 text-xs font-mono" />
                      <span className="text-xs text-muted-foreground">field to replace with surrogate ID</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground w-24 shrink-0 pt-1">Surrogate IDs:</span>
                      <div className="flex-1">
                        <Textarea
                          placeholder={"99999999\n88888888\n12345678"}
                          value={surrogateUiValues}
                          onChange={e => setSurrogateUiValues(e.target.value)}
                          className="font-mono text-xs min-h-[60px]"
                        />
                        <div className="text-[10px] text-muted-foreground mt-0.5">One surrogate user ID per line. Use nonexistent IDs for safe probing, or a dummy account ID for richer responses.</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Rounds per ID:</span>
                        <Input type="number" min={1} max={5} value={surrogateRounds} onChange={e => setSurrogateRounds(Number(e.target.value))} className="w-16 h-7 text-xs font-mono" />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={surrogateIncludeControl}
                          onChange={e => setSurrogateIncludeControl(e.target.checked)} className="accent-primary" />
                        <span className="text-xs text-muted-foreground">Include control (real UI request for comparison)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </label>

            {/* Cross */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" className="mt-1 accent-primary" checked={techniques.cross}
                onChange={e => setTechniques(prev => ({...prev, cross: e.target.checked}))} />
              <div className="flex-1">
                <div className="text-sm font-medium">Cross-Site Probe <span className="text-xs font-normal text-red-400 ml-1">✗ blocked by per-domain JWT signing</span></div>
                <div className="text-xs text-muted-foreground">
                  Alternates rounds using <span className="text-primary font-mono">opposite JWT tokens</span>: Site A's URL gets Site B's token, Site B's URL gets Site A's token.
                  The game server responds with real data but the action is attributed to an account with no active session on that site — no effect on either real game.
                  Uses raw sockets, not fetch.
                </div>
                {techniques.cross && (
                  <div className="mt-3 space-y-3" onClick={e => e.preventDefault()}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-16 shrink-0">Rounds:</span>
                      <Input type="number" min={2} max={20} value={crossRounds}
                        onChange={e => setCrossRounds(parseInt(e.target.value) || 2)}
                        className="w-20 h-7 text-xs" />
                      <span className="text-xs text-muted-foreground">(split evenly A/B)</span>
                    </div>

                    <div className="border border-dashed border-border/60 rounded-md p-3 space-y-2 bg-muted/5">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Site B config</div>

                      <div className="flex items-center gap-2">
                        <select
                          className="h-7 rounded border border-border bg-input px-2 text-xs font-mono font-bold shrink-0 w-24 appearance-none text-center"
                          value={siteBMethod}
                          onChange={e => setSiteBMethod(e.target.value as ProxyRequestInputMethod)}
                        >
                          {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <Input
                          className="flex-1 font-mono text-xs h-7"
                          placeholder="https://1x-bet.mobi/games-frame/service-api/..."
                          value={siteBUrl}
                          onChange={e => setSiteBUrl(e.target.value)}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Input
                          list="auth-header-names-crossB"
                          placeholder="Header (x-auth)"
                          className="font-mono text-xs h-7 w-28 shrink-0"
                          value={siteBAuthHeader}
                          onChange={e => setSiteBAuthHeader(e.target.value)}
                        />
                        <datalist id="auth-header-names-crossB">
                          <option value="x-auth" />
                          <option value="Authorization" />
                        </datalist>
                        <Input
                          type="password"
                          placeholder="Site B bearer token (eyJhbGci...)"
                          className="flex-1 font-mono text-xs h-7"
                          value={siteBToken}
                          onChange={e => setSiteBToken(e.target.value)}
                        />
                      </div>

                      <Textarea
                        className="font-mono text-xs resize-none h-16"
                        placeholder={'{"WH":114,"LG":"en","GT":202,"UI":845810773,"AN":1,"UC":1}'}
                        value={siteBBody}
                        onChange={e => setSiteBBody(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </label>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {techniques.cross ? 'Site A Authentication' : 'Authentication'}
          </h3>
          <div className="flex items-center gap-2">
            <div className="w-40 shrink-0">
              <Input 
                list="auth-header-names-probe"
                placeholder="Header Name"
                className="font-mono text-sm bg-muted text-muted-foreground h-9"
                value={request.authHeaderName}
                onChange={e => setRequest({...request, authHeaderName: e.target.value})}
                title="Auth Header Name"
              />
              <datalist id="auth-header-names-probe">
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
          {request.bearerToken && <JwtDecoder token={request.bearerToken} />}
        </section>

        {['POST', 'PUT', 'PATCH'].includes(request.method) && (
          <section className="space-y-2 flex-1 flex flex-col min-h-[200px]">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {techniques.cross ? 'Site A Body' : 'Body'}
              </h3>
              <select 
                className="bg-transparent text-xs font-mono text-muted-foreground focus:outline-none focus:text-primary appearance-none cursor-pointer"
                value={request.contentType}
                onChange={e => setRequest({...request, contentType: e.target.value})}
              >
                <option value="application/json">application/json</option>
                <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                <option value="text/plain">text/plain</option>
              </select>
            </div>
            <Textarea 
              className="flex-1 font-mono text-xs resize-none"
              placeholder='{&#10;  "key": "value"&#10;}'
              value={request.body}
              onChange={e => setRequest({...request, body: e.target.value})}
            />
          </section>
        )}
      </div>
    </div>
  );
}
