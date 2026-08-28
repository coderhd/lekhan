/**
 * Server-side snapshot encryption-at-rest (ADR 0001).
 * CommonJS facade for the y-websocket hub.
 * Single source of truth is lib/server-crypto-impl.js — edit there.
 */
module.exports = require('../lib/server-crypto-impl.js')
