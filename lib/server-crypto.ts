/**
 * Server-side snapshot encryption-at-rest (ADR 0001).
 * ESM facade over lib/server-crypto-impl.js — single source of truth.
 * Both lib/server-crypto.ts and server/crypto.js delegate here; edit the impl, not this file.
 */

import impl from './server-crypto-impl.js'

export const MAGIC_HEADER: Buffer = impl.MAGIC_HEADER
export const IV_LENGTH: number = impl.IV_LENGTH
export const TAG_LENGTH: number = impl.TAG_LENGTH
export const HEADER_LENGTH: number = impl.HEADER_LENGTH
export const DEFAULT_DEV_SECRET: string = impl.DEFAULT_DEV_SECRET
export const deriveKeyFromSecret: (secret: string) => Buffer = impl.deriveKeyFromSecret
export const isEncryptedSnapshot: (data: Buffer | Uint8Array) => boolean = impl.isEncryptedSnapshot
export const encryptSnapshot: (plaintext: Buffer | Uint8Array) => Buffer = impl.encryptSnapshot
export const decryptSnapshot: (data: Buffer | Uint8Array) => Buffer = impl.decryptSnapshot
