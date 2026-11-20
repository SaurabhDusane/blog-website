import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { normalizePublicLink } from './source-link-status.mjs';

const privateNetworks = new BlockList();
const specialIPv4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['168.63.129.16', 32], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
];
for (const [network, prefix] of specialIPv4) privateNetworks.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  privateNetworks.addSubnet(network, prefix, 'ipv6');
}
const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');

export function allowsPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !privateNetworks.check(address, 'ipv4');
  return family === 6 && globalIPv6.check(address, 'ipv6') && !privateNetworks.check(address, 'ipv6');
}

async function resolvePublicAddress(hostname, timeout) {
  let timer;
  try {
    const records = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup took too long')), timeout);
      }),
    ]);
    if (!records.length || records.some(({ address }) => !allowsPublicAddress(address))) {
      throw new Error('DNS returned a non-public address');
    }
    // The socket uses this exact DNS result, including on hosts with a short DNS TTL.
    return records.find(({ family }) => family === 4) ?? records[0];
  } finally {
    clearTimeout(timer);
  }
}

function requestPinned(url, address, timeout, bodyLimit) {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const headers = {
    Accept: bodyLimit ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.8',
    'User-Agent': 'SecondInkSourceCheck/1.0',
  };
  if (!bodyLimit) headers.Range = 'bytes=0-1023';

  return new Promise((resolve, reject) => {
    const connection = request(url, {
      agent: false,
      family: address.family,
      lookup(_hostname, options, callback) {
        if (options.all) callback(null, [address]);
        else callback(null, address.address, address.family);
      },
      signal: AbortSignal.timeout(timeout),
      headers,
    }, (response) => {
      const result = {
        status: response.statusCode ?? 0,
        location: response.headers.location,
        body: '',
      };
      response.once('error', reject);

      if (!bodyLimit || result.status !== 200) {
        resolve(result);
        response.destroy();
        return;
      }

      let bytes = 0;
      const chunks = [];
      response.on('data', (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > bodyLimit) {
          response.destroy(new Error('Response exceeded the check limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('end', () => resolve({ ...result, body: Buffer.concat(chunks).toString('utf8') }));
    });
    connection.once('error', reject);
    connection.end();
  });
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

export async function requestPublic(value, { redirects = 3, timeout = 6000, bodyLimit = 0 } = {}) {
  const end = Date.now() + timeout;
  let nextUrl = value;

  for (let hop = 0; hop <= redirects; hop += 1) {
    const url = normalizePublicLink(nextUrl);
    if (!url) throw new Error('Source uses a non-public URL or an unsupported port');
    if (end <= Date.now()) throw new Error('Link check took too long');
    const address = await resolvePublicAddress(url.hostname, end - Date.now());
    if (end <= Date.now()) throw new Error('Link check took too long');
    const result = await requestPinned(url, address, end - Date.now(), bodyLimit);
    if (!redirectStatuses.has(result.status) || !result.location) return result;
    if (hop === redirects) throw new Error('Too many redirects');
    nextUrl = new URL(result.location, url).href;
  }
}
