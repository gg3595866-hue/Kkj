import React, { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Sidebar } from './Sidebar';
import { RequestBuilder } from './RequestBuilder';
import { ResponsePanel } from './ResponsePanel';
import { AppRequestState } from './types';
import { ProxyResponse } from '@workspace/api-client-react';

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
    headers: [],
    body: '',
    contentType: 'application/json'
  });

  const [response, setResponse] = useState<ProxyResponse | { error: any } | null>(null);

  useEffect(() => {
    localStorage.setItem('auth_passer_bearer', request.bearerToken);
  }, [request.bearerToken]);

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
          <RequestBuilder request={request} setRequest={setRequest} setResponse={setResponse} />
        </Panel>
        
        <ResizeHandle />
        
        <Panel defaultSize={40} minSize={20}>
          <ResponsePanel response={response} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
