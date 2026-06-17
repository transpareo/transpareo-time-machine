/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * ESLint flat config. Deliberately minimal: the
 * codebase is hand-styled to a specific aesthetic
 * (short functions, shallow nesting, JS-style ASI,
 * no semicolons-except-at-statement-starts) that no
 * lint rule reproduces well. This config enforces
 * only the rules that catch a genuine class of bug,
 * not those that reformat a working file.
 *
 * Run: `npm run lint` (writes nothing; just reports).
 * The CI gate runs the same command.
 */
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import { defineConfig } from 'eslint/config'

export default defineConfig(
  {
    ignores: [
      'dist',
      'dist-embed',
      'node_modules',
      'public',
      'playwright-report',
      'test-results',
      '.playwright-mcp',

      // Vendored third-party crypto (noble-ed25519, MIT);
      // kept byte-for-byte so it is not held to our style.
      'src/crypto/ed25519.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Response: 'readonly',
        process: 'readonly',
        globalThis: 'readonly',
      },
    },
    rules: {
      // The audit's "no escape hatch without a reason"
      // rule. `as any` should never appear; explicit
      // `any` annotations either. Casts to specific
      // types are still allowed because the codebase
      // has 78 of them and most are legitimate DOM
      // narrowings.
      '@typescript-eslint/no-explicit-any': 'error',

      // Catch the common `let x = 0; ... never reassigned`
      // mistake. Pure quality-of-life.
      'prefer-const': 'error',

      // The codebase is strict-mode ESM only; var has no
      // place in it.
      'no-var': 'error',

      // Console output should be deliberate. We allow
      // warn + error (boundary error logging is a real
      // pattern in this codebase, prefixed with the
      // module name) but flag stray .log debris.
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Catch holes in switch statements where a case
      // forgets a `break` or `return`.
      'no-fallthrough': 'error',

      // Unused vars / params with a `_` prefix are
      // intentional (placeholder param, exhaustive
      // destructuring); without the prefix they signal
      // dead code.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // The `Function` type is a footgun: it accepts any
      // callable. Forces the author to type the actual
      // signature.
      '@typescript-eslint/no-unsafe-function-type': 'error',

      // We use `interface Foo { ... }` everywhere; this
      // rule pushes back if someone accidentally types
      // `type Foo = {}` (empty object types match almost
      // anything, including primitives).
      '@typescript-eslint/no-empty-object-type': 'warn',

      // Catch genuine equality bugs while still allowing
      // `null == undefined` (which TS handles cleanly
      // with `??`).
      'eqeqeq': ['error', 'smart'],
    },
  },
  {
    // Scripts under /scripts are CLI tools, not library
    // code: they print progress to stdout deliberately
    // and that pattern shouldn't be reported as debris.
    files: ['scripts/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
