import React, { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar } from './Sidebar';
import { RequestBuilder } from './RequestBuilder';
import { ResponsePanel } from './ResponsePanel';
import { ProbeTab } from './ProbeTab';
import { ProbeResults } from './ProbeResults';
import { BypassTab } from './BypassTab';
import { BypassResults } from './BypassResults';
import { ScanTab } from './ScanTab';
import { ScanResults } from './ScanResults';
import { ReconTab } from './ReconTab';
import { ReconResults } from './ReconResults';
import { AppRequestState } from './types';
import { ProxyResponse } from '@workspace/api-client-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/core';

function ResizeHandle() {
  return (
    <PanelResizeHandle className="w-1 bg-border hover:bg-primary transition-colors data-[resize-handle-state=drag]:bg-primary z-10" />
  );
}

export default function Workspace() {
  const [request, setRequest] = useState<AppRequestState>({
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    method: 'GET',
    bearerToken: localStorage.getItem('auth_passer_bearer') || '',
    authHeaderName: localStorage.getItem('authHeaderName') || 'Authorization',
    headers: [],
    body: '',
    contentType: 'application/json'
  });

  const [response, setResponse] = useState<ProxyResponse | { error: any } | null>(null);
  const [activeTab, setActiveTab] = useState('builder');

  // Fires whenever Recon's "route here" is clicked on an origin IP, so tabs
  // that keep their own local base-URL state (Scan) can resync even when the
  // ip/domain pair repeats. Builder/Probe/Bypass don't need this — they read
  // `request` directly, which is updated in the same action.
  const [reconTarget, setReconTarget] = useState<{ ip: string; domain: string; nonce: number } | null>(null);

  const handleRouteThrough = (url: string) => {
    setRequest(prev => ({ ...prev, url }));
    setActiveTab('builder');
  };

  // Route a confirmed/candidate origin IP from Recon into Builder (and, via
  // shared state, Probe/Bypass too — same directip-bypass technique the
  // Bypass tab already uses under the hood, just persisted as the active
  // target instead of a one-off diagnostic call). Preserves the path+query
  // of the current request if it was targeting the same domain, otherwise
  // defaults to "/". Adds/updates a Host header so the direct-IP request
  // still resolves to the right vhost on the origin.
  const handleRouteThroughIp = (ip: string, domain: string) => {
    let path = '/';
    try {
      const current = new URL(request.url);
      if (current.hostname === domain || current.hostname.endsWith(`.${domain}`)) {
        path = `${current.pathname}${current.search}`;
      }
    } catch { /* current URL not parseable — fall back to root */ }

    setRequest(prev => {
      const headers = prev.headers.filter(h => h.key.trim().toLowerCase() !== 'host');
      headers.push({ id: crypto.randomUUID(), key: 'Host', value: domain });
      return { ...prev, url: `https://${ip}${path}`, headers };
    });
    setReconTarget({ ip, domain, nonce: Date.now() });
    setActiveTab('builder');
  };

  // Route a discovered non-Cloudflare subdomain into Builder as a normal
  // hostname (no Host header override needed — it resolves directly).
  const handleRouteThroughDomain = (subdomain: string) => {
    setRequest(prev => ({ ...prev, url: `https://${subdomain}/` }));
    setActiveTab('builder');
  };

  useEffect(() => {
    localStorage.setItem('auth_passer_bearer', request.bearerToken);
  }, [request.bearerToken]);

  useEffect(() => {
    localStorage.setItem('authHeaderName', request.authHeaderName);
  }, [request.authHeaderName]);

  return (
    <div className="h-[100dvh] w-full flex flex-col overflow-hidden bg-background">
      <header className="h-10 border-b border-border flex items-center px-4 shrink-0 bg-card">
        <div className="font-mono font-bold text-primary tracking-tight text-sm">Auth_Passer</div>
      </header>
      
      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <Sidebar request={request} setRequest={setRequest} />
        </Panel>
        
        <ResizeHandle />
        
        <Panel defaultSize={40} minSize={30}>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full border-r">
            <div className="h-10 border-b flex items-center px-4 shrink-0 bg-card">
              <TabsList className="bg-background">
                <TabsTrigger value="builder">Builder</TabsTrigger>
                <TabsTrigger value="probe">Probe</TabsTrigger>
                <TabsTrigger value="bypass">Bypass</TabsTrigger>
                <TabsTrigger value="scan">Scan</TabsTrigger>
                <TabsTrigger value="recon">Recon</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="builder" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col">
              <RequestBuilder request={request} setRequest={setRequest} setResponse={setResponse} />
            </TabsContent>
            <TabsContent value="probe" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col">
              <ProbeTab request={request} setRequest={setRequest} setResponse={setResponse} />
            </TabsContent>
            <TabsContent value="bypass" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col">
              <BypassTab request={request} setRequest={setRequest} setResponse={setResponse} />
            </TabsContent>
            <TabsContent value="scan" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col">
              <ScanTab request={request} setRequest={setRequest} setResponse={setResponse} onRouteThrough={handleRouteThrough} reconTarget={reconTarget} />
            </TabsContent>
            <TabsContent value="recon" className="flex-1 overflow-hidden m-0 data-[state=active]:flex flex-col">
              <ReconTab setResponse={setResponse} />
            </TabsContent>
          </Tabs>
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={40} minSize={20}>
          {response && (response as any)._isProbe ? (
            <ProbeResults response={response} />
          ) : response && (response as any)._isBypass ? (
            <BypassResults response={response} />
          ) : response && (response as any)._isScan ? (
            <ScanResults response={response} baseUrl={(response as any).baseUrl} queryParams={(response as any).queryParams} onRouteThrough={handleRouteThrough} />
          ) : response && (response as any)._isRecon ? (
            <ReconResults response={response} onRouteThroughIp={handleRouteThroughIp} onRouteThroughDomain={handleRouteThroughDomain} />
          ) : (
            <ResponsePanel response={response} />
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
