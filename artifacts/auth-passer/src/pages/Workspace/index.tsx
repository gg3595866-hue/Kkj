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

  const handleRouteThrough = (url: string) => {
    setRequest(prev => ({ ...prev, url }));
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
              <ScanTab request={request} setRequest={setRequest} setResponse={setResponse} onRouteThrough={handleRouteThrough} />
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
            <ReconResults response={response} />
          ) : (
            <ResponsePanel response={response} />
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}
