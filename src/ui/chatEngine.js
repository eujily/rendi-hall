// Pure chat logic (no DOM): walks a scripted node graph.
// script = { start: 'intro', nodes: { id: { msgs: [{from, text}], replies: [{label, to} | {label, action}] } } }
// Events: { type: 'msg', from, text } | { type: 'replies', replies } | { type: 'action', action }

export function createChatEngine(script) {
  let replies = [];

  const enter = (id) => {
    const node = script.nodes[id];
    if (!node) {
      replies = [];
      return [];
    }
    const events = node.msgs.map((m) => ({ type: 'msg', from: m.from, text: m.text }));
    replies = node.replies ?? [];
    if (replies.length) events.push({ type: 'replies', replies });
    return events;
  };

  return {
    start() {
      return enter(script.start);
    },
    choose(replyIndex) {
      const reply = replies[replyIndex];
      if (!reply) return [];
      replies = [];
      if (reply.action) return [{ type: 'action', action: reply.action }];
      return [{ type: 'msg', from: 'randy', text: reply.label }, ...enter(reply.to)];
    },
  };
}
