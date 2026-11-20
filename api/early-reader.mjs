import { relayEarlyReader } from '../scripts/early-reader-relay.mjs';

export default {
  fetch(request) {
    return relayEarlyReader(request, process.env);
  },
};
