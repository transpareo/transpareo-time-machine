// @vitest-environment happy-dom
/*
 * transpareo-time-machine - open-source DPP renderer
 * Copyright (C) 2026 Transpareo AG
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * The html`` tagged-template engine behind every
 * declarative component: static structure, the five
 * binding kinds (text, attribute, @event, ?bool, .prop),
 * reactivity through the registered effects, and the
 * BEL-delimited marker contract (author markup that looks
 * like a marker must render as literal text).
 */

import { describe, it, expect } from 'vitest';
import { html } from '../src/reactive/html';
import { signal, effect } from '../src/reactive/signals';

// The host's effect() shape: register the binding with the
// real signal engine so set() re-runs it, exactly like
// BaseElement.effect does.
type Register = (fn: () => void | (() => void)) => void;
const register: Register = (fn) => { effect(fn); };

function mount(tpl: ReturnType<typeof html>): HTMLElement {
  const host = document.createElement('div');
  tpl.mount(host, register);
  return host;
}

describe('html template engine', () => {
  it('renders static markup verbatim', () => {
    const host = mount(html`
      <section class="a"><p>hello</p></section>`);
    expect(host.querySelector('section.a p')?.textContent).toBe('hello');
  });

  it('interpolates static values as escaped text', () => {
    const host = mount(html`<p>${'<b>not markup</b>'}</p>`);
    expect(host.querySelector('p')?.textContent).toBe('<b>not markup</b>');
    expect(host.querySelector('b')).toBeNull();
  });

  it('binds a function interpolation to a reactive text node', () => {
    const label = signal('first');
    const host = mount(html`<p>${() => label()}</p>`);
    expect(host.querySelector('p')?.textContent).toBe('first');
    label.set('second');
    expect(host.querySelector('p')?.textContent).toBe('second');
  });

  it('keeps surrounding static text around a binding', () => {
    const n = signal(2);
    const host = mount(html`<p>v${() => n()} of 6</p>`);
    expect(host.querySelector('p')?.textContent).toBe('v2 of 6');
  });

  it('inserts an interpolated Node directly', () => {
    const child = document.createElement('em');
    child.textContent = 'node';
    const host = mount(html`<p>${child}</p>`);
    expect(host.querySelector('p em')?.textContent).toBe('node');
  });

  it('binds a reactive attribute and removes it on null/false', () => {
    const title = signal<string | null>('tip');
    const host = mount(html`<p title=${() => title()}></p>`);
    const p = host.querySelector('p')!;
    expect(p.getAttribute('title')).toBe('tip');
    title.set(null);
    expect(p.hasAttribute('title')).toBe(false);
  });

  it('binds @event to addEventListener', () => {
    let clicks = 0;
    const host = mount(html`
      <button @click=${() => { clicks++; }}>go</button>`);
    const btn = host.querySelector('button')!;
    btn.click();
    btn.click();
    expect(clicks).toBe(2);
    expect(btn.hasAttribute('@click')).toBe(false);
  });

  it('toggles a ?bool attribute reactively', () => {
    const hidden = signal(false);
    const host = mount(html`<div ?hidden=${() => hidden()}></div>`);
    const div = host.querySelector('div')!;
    expect(div.hasAttribute('hidden')).toBe(false);
    hidden.set(true);
    expect(div.hasAttribute('hidden')).toBe(true);
  });

  it('assigns a .prop binding as a DOM property', () => {
    const value = signal('typed');
    const host = mount(html`<input .value=${() => value()} />`);
    const input = host.querySelector('input')!;
    expect(input.value).toBe('typed');
    value.set('changed');
    expect(input.value).toBe('changed');
  });

  it('renders marker-shaped author text literally', () => {
    // The binding markers are BEL-delimited precisely so
    // author markup that *looks* like a marker (a literal
    // "TM:0" in a label) can never be parsed as one.
    const host = mount(html`<p>TM:0 ${'x'} TM:1</p>`);
    expect(host.querySelector('p')?.textContent).toBe('TM:0 x TM:1');
  });
});
