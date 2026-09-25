import type { WebSocketServer, WebSocket } from 'ws';
import type { WsMessage } from './types.js';

type TaggedSocket = WebSocket & { _userOid?: string };

let dashboardWss: WebSocketServer | null = null;

/**
 * Wire the dashboard WSS into the presence module. Called once at server
 * startup from index.ts.
 */
export function setDashboardWss(wss: WebSocketServer): void {
  dashboardWss = wss;
}

/**
 * Send a typed WS message to every dashboard client whose authenticated user
 * OID matches. Returns the number of sockets the message was sent to.
 */
export function sendToUser(userOid: string, message: WsMessage): number {
  if (!dashboardWss) return 0;
  const data = JSON.stringify(message);
  let count = 0;
  for (const client of dashboardWss.clients) {
    const s = client as TaggedSocket;
    if (s.readyState !== 1 /* OPEN */) continue;
    if (s._userOid === userOid) {
      s.send(data);
      count++;
    }
  }
  return count;
}

/**
 * Returns the set of OIDs currently holding an open dashboard WebSocket.
 * Used to mark users as online in the admin list and to gate force-update.
 */
export function getOnlineUserOids(): Set<string> {
  const oids = new Set<string>();
  if (!dashboardWss) return oids;
  for (const client of dashboardWss.clients) {
    const s = client as TaggedSocket;
    if (s.readyState !== 1 /* OPEN */) continue;
    if (s._userOid) oids.add(s._userOid);
  }
  return oids;
}
