/**
 * Passwords, session tokens and invitation codes. Web Crypto only, so the same
 * code runs in the Worker and in the tests.
 */

const enc = new TextEncoder()

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const toBase64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

/** Workers cap PBKDF2 at 100 000 iterations. */
const ITERATIONS = 100_000

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

/** An invitation code a person can type: 12 letters and digits without look-alikes, in groups of four. */
export function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const pick = crypto.getRandomValues(new Uint8Array(12))
  const chars = [...pick].map((b) => alphabet[b % alphabet.length]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`
}

/** Invitation codes compare without dashes, spaces or case. */
export const normaliseCode = (code) => String(code ?? '').replace(/[\s-]/g, '').toUpperCase()

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password, saltBase64) {
  const salt = saltBase64 ? fromBase64(saltBase64) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256)
  return { hash: toBase64(bits), salt: toBase64(salt) }
}

/** Constant-time comparison, so a hash cannot be guessed byte by byte. */
export function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
