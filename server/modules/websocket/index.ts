export { WS_OPEN_STATE, connectedClients } from './services/websocket-state.service.js';
export { createWebSocketServer } from './services/websocket-server.service.js';
export { chatRunRegistry } from './services/chat-run-registry.service.js';
// Consumed by the providers module's sessions watcher, which announces the
// sessions it (re)indexed from disk through the same builder the chat gateway
// uses, so both paths put the identical delta on the wire.
export { broadcastSessionUpserted, broadcastSessionUpsertedBatch } from './services/session-upsert-broadcast.service.js';
// runDetachedChatTurn: used by the scheduled-messages module to run a turn
// from a timer, with no socket to stream to or report errors on.
export { runDetachedChatTurn } from './services/chat-websocket.service.js';
export type { ProviderRuntimeGateway } from './services/chat-websocket.service.js';
// Effect-only: subscribes the run registry to the Claude runtime's held-process
// lifecycle, so "this session still holds background work" reaches the UI.
//
// Wired here rather than from `server/index.ts` on purpose, and it is the one
// place in this module that earns a side effect. The state it carries has to be
// live wherever the chat gateway is — including in tests, which reach for
// `chatRunRegistry` through this barrel and would otherwise have to reproduce a
// boot path to observe it. A wire that only exists in production is a wire
// nothing checks.
//
// Its position in this file does not matter: the bridge imports the registry it
// writes into, so ESM evaluates that module first regardless.
import './services/background-work-bridge.service.js';
