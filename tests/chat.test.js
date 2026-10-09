import { describe, it, expect } from 'vitest';
import { createChatEngine } from '../src/ui/chatEngine.js';
import content from '../src/content/content.json';

const script = {
  start: 'a',
  nodes: {
    a: {
      msgs: [{ from: 'host', text: 'Hi!' }, { from: 'host', text: 'Pick one.' }],
      replies: [
        { label: 'Go b', to: 'b' },
        { label: 'Join', action: 'waitlist' },
      ],
    },
    b: { msgs: [{ from: 'host', text: 'You are at b.' }], replies: [{ label: 'Back', to: 'a' }] },
  },
};

const reachable = (chat) => {
  const seen = new Set();
  const stack = [chat.start];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !chat.nodes[id]) continue;
    seen.add(id);
    chat.nodes[id].replies.forEach((r) => r.to && stack.push(r.to));
  }
  return seen;
};
const hasWaitlist = (chat, id) => chat.nodes[id].replies.some((r) => r.action === 'waitlist');

describe('chat engine', () => {
  it('start shows start node', () => {
    const events = createChatEngine(script).start();
    expect(events.map((e) => e.type)).toEqual(['msg', 'msg', 'replies']);
    expect(events[0]).toEqual({ type: 'msg', from: 'host', text: 'Hi!' });
    expect(events[2].replies).toHaveLength(2);
  });

  it('reply appends randy line then target node', () => {
    const engine = createChatEngine(script);
    engine.start();
    const events = engine.choose(0);
    expect(events[0]).toEqual({ type: 'msg', from: 'randy', text: 'Go b' });
    expect(events[1]).toEqual({ type: 'msg', from: 'host', text: 'You are at b.' });
    expect(events.at(-1).type).toBe('replies');
  });

  it('action reply emits action', () => {
    const engine = createChatEngine(script);
    engine.start();
    expect(engine.choose(1)).toEqual([{ type: 'action', action: 'waitlist' }]);
  });

  it('ignores an unknown reply index', () => {
    const engine = createChatEngine(script);
    engine.start();
    expect(engine.choose(9)).toEqual([]);
  });
});

const allGraphs = [...content.products, ...content.places];

describe('content graphs', () => {
  it('has the about/how/news places', () => {
    expect(content.places.map((p) => p.id)).toEqual(['about', 'how', 'news']);
  });

  it('has the six products the hall expects', () => {
    expect(content.products.map((p) => p.id)).toEqual(['learn', 'pay', 'flow', 'care', 'home', 'studio']);
    content.products.forEach((p) => {
      expect(p.name && p.tagline && p.host.name).toBeTruthy();
      expect(['purple', 'yellow', 'black', 'red', 'lavender']).toContain(p.accent);
      expect(['purple', 'yellow', 'white', 'red', 'lavender', 'black']).toContain(p.host.color);
    });
    expect(content.npcs.map((n) => n.id)).toEqual(['v1', 'v2', 't1', 't2', 't3', 't4']);
  });

  it('every product graph reaches waitlist', () => {
    for (const p of allGraphs) {
      const ids = [...reachable(p.chat)];
      expect(ids.some((id) => hasWaitlist(p.chat, id)), p.id).toBe(true);
    }
  });

  it('every node can reach waitlist (no dead ends)', () => {
    for (const p of allGraphs) {
      for (const start of Object.keys(p.chat.nodes)) {
        const ids = [...reachable({ ...p.chat, start })];
        expect(ids.some((id) => hasWaitlist(p.chat, id)), `${p.id}/${start}`).toBe(true);
      }
    }
  });

  it('no dangling "to"', () => {
    for (const p of allGraphs) {
      expect(p.chat.nodes[p.chat.start], `${p.id} start`).toBeDefined();
      for (const [id, node] of Object.entries(p.chat.nodes)) {
        expect(node.replies.length, `${p.id}/${id} has replies`).toBeGreaterThan(0);
        node.replies.forEach((r) => {
          expect(Boolean(r.to) !== Boolean(r.action), `${p.id}/${id}/${r.label}`).toBe(true);
          if (r.to) expect(p.chat.nodes[r.to], `${p.id}/${id} -> ${r.to}`).toBeDefined();
        });
      }
    }
  });

  it('keeps each graph between 5 and 7 nodes and every message to two sentences', () => {
    const sentences = (t) => (t.match(/[.!?…]+(\s|$)/g) ?? []).length;
    for (const p of allGraphs) {
      const nodes = Object.values(p.chat.nodes);
      expect(nodes.length).toBeGreaterThanOrEqual(3);
      expect(nodes.length).toBeLessThanOrEqual(7);
      nodes.forEach((n) => n.msgs.forEach((m) => expect(sentences(m.text), m.text).toBeLessThanOrEqual(2)));
    }
  });
});
