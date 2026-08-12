/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Both verification surfaces attribute groups of proof
 * entries to the issuer and the platform, and they have to
 * agree: the proof modal's per-version columns and the
 * standalone widget's authority cards. Four kinds of evidence
 * feed one rule - a pin the host page set, a key-path URL as
 * an eddsa-jcs proof set writes it, the did:web method an
 * ecdsa-sd credential names per authority, and the structure
 * of a two-party passport.
 */

import { describe, it, expect } from 'vitest'
import { attributeAuthorities } from '@/verifier-verdict'
import type { AuthorityEntry } from '@/verifier-verdict'

const DECLARED = {
  issuerDid: 'did:web:acme.example',
  platformDid: 'did:web:platform.example'
}

function group(...methods: string[]): AuthorityEntry[] {
  return methods.map((verificationMethod) => ({ verificationMethod }))
}

// One group's kind, with no second group to complete it.
function kindOf(...methods: string[]): string | undefined {
  return attributeAuthorities([group(...methods)], DECLARED)[0]
}

describe('attributeAuthorities: eddsa-jcs key paths', () => {
  it('reads the issuer off a keys/issuer.json alias', () => {
    expect(kindOf('https://cdn.example/p/keys/issuer.json')).toBe('issuer')
  })

  it('reads the platform off a keys/platform.json alias', () => {
    expect(kindOf('https://cdn.example/p/keys/platform.json#cdn')).
      toBe('platform')
  })

  it('reads the kind off any alias in the group', () => {
    expect(kindOf(
      'https://cdn.example/p/other.json',
      'https://cdn.example/p/keys/issuer.json#did-web',
    )).toBe('issuer')
  })
})

describe('attributeAuthorities: ecdsa-sd did:web methods', () => {
  it('matches the issuer DID the DPP declares', () => {
    expect(kindOf('did:web:acme.example#key-2')).toBe('issuer')
  })

  it('matches the platform DID the DPP declares', () => {
    expect(kindOf('did:web:platform.example#key-3')).toBe('platform')
  })

  it('leaves an undeclared DID unattributed', () => {
    expect(kindOf('did:web:stranger.example#key-1')).toBe('other')
  })

  it('matches a fragmentless method', () => {
    expect(kindOf('did:web:acme.example')).toBe('issuer')
  })

  it('does not attribute anything without declared DIDs', () => {
    const kinds = attributeAuthorities(
      [group('did:web:acme.example#key-2')], {},
    )
    expect(kinds).toEqual(['other'])
  })

  it('requires the whole DID, not a domain suffix', () => {
    // did:web:evil-acme.example ends with the issuer's
    // domain but is a different identifier.
    expect(kindOf('did:web:evil-acme.example#key-2')).toBe('other')
  })
})

describe('attributeAuthorities: the two-party structure', () => {
  it('names the group opposite an identified platform', () => {
    // The production shape: the issuer signs with a key under
    // a did:web host of its own, which the passport never
    // declares. The counter-signature identifies the platform,
    // and a DPP has exactly two signing parties.
    const kinds = attributeAuthorities([
      group('did:web:dpp.acme-corp.com#key-1'),
      group('did:web:platform.example#key-3'),
    ], DECLARED)
    expect(kinds).toEqual(['issuer', 'platform'])
  })

  it('names the group opposite an identified issuer', () => {
    const kinds = attributeAuthorities([
      group('https://cdn.example/p/keys/issuer.json'),
      group('did:web:signer.example#key-9'),
    ], DECLARED)
    expect(kinds).toEqual(['issuer', 'platform'])
  })

  it('leaves both unattributed when neither is identified', () => {
    const kinds = attributeAuthorities([
      group('did:web:one.example#key-1'),
      group('did:web:two.example#key-1'),
    ], DECLARED)
    expect(kinds).toEqual(['other', 'other'])
  })

  it('does not guess across three groups', () => {
    // Two issuer keys plus one unknown: nothing says which
    // party the unknown belongs to, so it keeps no name.
    const kinds = attributeAuthorities([
      group('https://cdn.example/p/keys/issuer.json'),
      group('https://cdn.example/p/keys/issuer.json#rotated'),
      group('did:web:signer.example#key-9'),
    ], DECLARED)
    expect(kinds).toEqual(['issuer', 'issuer', 'other'])
  })
})

describe('attributeAuthorities: pinned keys', () => {
  it('names a pinned group this platform', () => {
    const kinds = attributeAuthorities([
      [{ verificationMethod: 'did:web:stranger.example#k', pinned: true }],
    ], DECLARED)
    expect(kinds).toEqual(['platform'])
  })

  it('lets the pin outrank a key path', () => {
    // A platform key served from the issuer's own key
    // directory: the host page pinned it, which is the
    // stronger statement about whose key it is.
    const kinds = attributeAuthorities([
      [{
        verificationMethod: 'https://cdn.example/p/keys/issuer.json',
        pinned: true
      }],
    ], DECLARED)
    expect(kinds).toEqual(['platform'])
  })

  it('completes the other party from a pin alone', () => {
    const kinds = attributeAuthorities([
      group('did:web:dpp.acme-corp.com#key-1'),
      [{ verificationMethod: 'did:web:stranger.example#k', pinned: true }],
    ], DECLARED)
    expect(kinds).toEqual(['issuer', 'platform'])
  })

  it('attributes a foreign passport that matches no pin', () => {
    // Nothing pinned here: the widget verifies foreign DPPs,
    // whose proofs belong to their own two parties.
    const kinds = attributeAuthorities([
      group('https://foreign.example/p/keys/issuer.json'),
      group('https://foreign.example/p/keys/platform.json'),
    ], {})
    expect(kinds).toEqual(['issuer', 'platform'])
  })
})

describe('attributeAuthorities: precedence', () => {
  it('lets the key path win over a declared DID', () => {
    // A platform-hosted issuer key alias: the path names the
    // role directly, the DID only names who controls the
    // host, so the path is the stronger signal.
    expect(kindOf('https://platform.example/keys/issuer.json')).toBe('issuer')
  })

  it('leaves an unrecognised https method unattributed', () => {
    expect(kindOf('https://cdn.example/p/keys/backup.json')).toBe('other')
  })
})
