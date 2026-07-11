import { ProxyRequestInputMethod } from '@workspace/api-client-react';

export interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

export interface AppRequestState {
  url: string;
  method: ProxyRequestInputMethod;
  bearerToken: string;
  headers: HeaderRow[];
  body: string;
  contentType: string;
}
