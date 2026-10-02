/**
 * Peer Hives — other SI Hive instances this one can hand sessions to.
 *
 * Two lists, both in config.json (secrets live in the credential store):
 *   - `peers`       — Hives we call. Each has an outbound token, issued BY that
 *                     peer, stored at `peer:<id>:outToken`.
 *   - `peerTokens`  — tokens we issued, so other Hives can call us. Only a
 *                     SHA-256 of each token is stored, at `peerin:<id>`.
 */
import http from 'node:http';
import os from 'node:os';
import type { HiveConfig } from '../types.js';

export interface PeerConfig {
  /** Slug, e.g. "home-server". */
  id: string;
  label: string;
  /** Root URL of the other Hive, e.g. https://box.example.ts.net */
  baseUrl: string;
  /** Fast-forward committed project work with this peer in the background (sync.ts). */
  autoSync?: boolean;
}

export interface PeerTokenMeta {
  id: string;
  /** Who the token was issued to, e.g. "Laptop". */
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

export interface PeersConfigShape {
  peers?: PeerConfig[];
  peerTokens?: PeerTokenMeta[];
  /** How this Hive is reached by its peers (shown on the other side). */
  publicUrl?: string;
}

export function isValidPeerId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,30}$/.test(id);
}

export function outTokenRef(peerId: string): string {
  return `peer:${peerId}:outToken`;
}

export function inTokenRef(tokenId: string): string {
  return `peerin:${tokenId}`;
}

/** `box.example.ts.net:4747` → `http://box.example.ts.net:4747`, no trailing slash. */
export function normalizePeerUrl(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

export function listPeers(config: HiveConfig): PeerConfig[] {
  const peers = (config as PeersConfigShape).peers;
  return Array.isArray(peers) ? peers : [];
}

export function getPeer(config: HiveConfig, id: string): PeerConfig | undefined {
  return listPeers(config).find((p) => p.id === id);
}

export function listPeerTokens(config: HiveConfig): PeerTokenMeta[] {
  const tokens = (config as PeersConfigShape).peerTokens;
  return Array.isArray(tokens) ? tokens : [];
}

/** A configured peer whose URL matches, so a caller can be shown by its own label. */
export function findPeerByUrl(config: HiveConfig, url: string | undefined): PeerConfig | undefined {
  if (!url) return undefined;
  const want = normalizePeerUrl(url).toLowerCase();
  return listPeers(config).find((p) => normalizePeerUrl(p.baseUrl).toLowerCase() === want);
}

/** A readable, unique slug from a label: "Home server" → "home-server", "home-server-2", … */
export function slugFor(label: string, taken: Set<string>, fallback = 'peer'): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** This Hive's name as shown on its peers. */
export function selfName(config: HiveConfig): string {
  const name = (config.user as { name?: string } | undefined)?.name;
  return name ? `${name}'s ${os.hostname()}` : os.hostname();
}

/**
 * How peers reach this Hive: HIVE_PUBLIC_URL / publicUrl when set, else the
 * Host the browser used (unless that is loopback, which is useless elsewhere).
 */
export function selfUrl(config: HiveConfig, req?: http.IncomingMessage): string | undefined {
  const configured = process.env.HIVE_PUBLIC_URL || (config as PeersConfigShape).publicUrl;
  if (configured) return normalizePeerUrl(configured);
  const host = req?.headers.host;
  if (!host || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)) return undefined;
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http';
  return `${proto}://${host}`;
}
