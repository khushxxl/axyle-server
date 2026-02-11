/**
 * Simple in-memory event broadcaster using Node.js EventEmitter.
 * Used to push real-time events (e.g. payment notifications) from
 * webhook handlers to SSE-connected clients.
 */

import { EventEmitter } from "events";

const broadcaster = new EventEmitter();
broadcaster.setMaxListeners(100);

export default broadcaster;
