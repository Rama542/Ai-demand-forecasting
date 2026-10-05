"use client";

import * as React from "react";
import { Card, Button, Badge, Field, Disclaimer } from "@/components/ui";
import { Icon } from "@/components/ui/Icon";
import { useAction, useLocalStorage } from "@/lib/hooks";
import { api, type MentorReply } from "@/lib/api";
import { PageHeader } from "@/components/shell/UserMenu";
import { SymbolInput } from "@/components/SymbolInput";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  provider?: MentorReply["provider"];
  model?: MentorReply["model"];
}

const SUGGESTIONS = [
  "What does a Sharpe ratio of 0.4 actually mean?",
  "Why did my backtest underperform buy and hold?",
  "How should I read the TreeSHAP contributions on the research page?",
  "What is the difference between correlation and diversification?",
];

export default function MentorPage() {
  const [messages, setMessages] = useLocalStorage<Message[]>("mentor-thread", []);
  const [input, setInput] = React.useState("");
  const [symbol, setSymbol] = React.useState("");
  const endRef = React.useRef<HTMLDivElement>(null);

  const send = useAction(async (text: string) => {
    const reply = await api.mentor({ message: text, symbol: symbol.trim() || undefined });
    return reply;
  });

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || send.pending) return;

    const userMessage: Message = { id: `u-${Date.now()}`, role: "user", text: trimmed };
    setMessages([...messages, userMessage]);
    setInput("");

    const reply = await send.run(trimmed);
    if (reply) {
      setMessages([
        ...messages,
        userMessage,
        { id: `a-${Date.now()}`, role: "assistant", text: reply.answer, provider: reply.provider, model: reply.model },
      ]);
    }
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  };

  return (
    <main className="page">
      <PageHeader
        eyebrow="Intelligence"
        title="AI Mentor"
        description="Ask about the metrics, the methodology or the backtest engine. Replies are educational explanations, never buy or sell instructions."
        actions={
          messages.length > 0 ? (
            <Button
              variant="ghost"
              icon="trash"
              onClick={() => setMessages([])}
            >
              Clear thread
            </Button>
          ) : null
        }
      />

      <div className="grid grid-sidebar" style={{ alignItems: "start" }}>
        <Card title="Context" className="stack">
          <Field label="Focus instrument (optional)" htmlFor="mentor-symbol">
            <SymbolInput id="mentor-symbol" value={symbol} onChange={setSymbol} placeholder="RELIANCE" />
          </Field>
          <p className="faint" style={{ fontSize: "var(--text-xs)" }}>
            Naming an instrument lets the mentor quote that symbol&apos;s actual figures instead of explaining the general
            concept.
          </p>
          <div className="divider" />
          <div className="col gap-2">
            <span className="field-label">Try asking</span>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="dropdown-item"
                style={{ border: "1px solid var(--border-subtle)", height: "auto", padding: "8px 10px" }}
                onClick={() => submit(suggestion)}
                disabled={send.pending}
              >
                <Icon name="sparkles" size={13} />
                <span style={{ whiteSpace: "normal", lineHeight: 1.45 }}>{suggestion}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="card-pad-0">
          <div className="col" style={{ minHeight: 420, maxHeight: "62vh", overflowY: "auto", padding: "var(--sp-5)" }}>
            {messages.length === 0 ? (
              <div className="state">
                <div className="state-icon">
                  <Icon name="mentor" size={19} />
                </div>
                <h3>Ask about anything in this workspace</h3>
                <p>
                  The mentor explains how the numbers are produced — backtest mechanics, risk metrics, model behaviour and
                  portfolio construction. It is a teaching tool, not an adviser.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className="col"
                  style={{
                    alignItems: message.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: "var(--sp-4)",
                  }}
                >
                  <div className="row gap-2" style={{ marginBottom: 4 }}>
                    <span className="faint" style={{ fontSize: "var(--text-xs)" }}>
                      {message.role === "user" ? "You" : "Mentor"}
                    </span>
                    {message.provider === "fallback" ? <Badge tone="warn">rule-based fallback</Badge> : null}
                    {message.provider && message.provider !== "fallback" ? (
                      <Badge tone="accent">{message.model ? `${message.provider} · ${message.model}` : message.provider}</Badge>
                    ) : null}
                  </div>
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "var(--sp-3) var(--sp-4)",
                      borderRadius: "var(--radius)",
                      background: message.role === "user" ? "var(--accent-soft)" : "var(--bg-subtle)",
                      border: `1px solid ${message.role === "user" ? "var(--accent-border)" : "var(--border-subtle)"}`,
                      fontSize: "var(--text-base)",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {message.text}
                  </div>
                </div>
              ))
            )}
            {send.pending ? (
              <div className="row gap-2 muted" style={{ fontSize: "var(--text-sm)" }}>
                <Icon name="loader" size={14} spin />
                <span>Thinking…</span>
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="col gap-2" style={{ padding: "var(--sp-4) var(--sp-5)", borderTop: "1px solid var(--border-subtle)" }}>
            <div className="row gap-2" style={{ alignItems: "flex-end" }}>
              <textarea
                className="textarea grow"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit(input);
                  }
                }}
                placeholder="Ask a question about the analysis…"
                aria-label="Message"
                rows={2}
                disabled={send.pending}
              />
              <Button variant="primary" onClick={() => submit(input)} loading={send.pending} disabled={!input.trim()} aria-label="Send message">
                <Icon name="arrowRight" />
              </Button>
            </div>
            {send.error ? (
              <p className="faint" style={{ fontSize: "var(--text-xs)", color: "var(--bear)" }}>
                {send.error}
              </p>
            ) : null}
            <Disclaimer>
              Educational explanations only. Nothing here is a recommendation, and past simulated performance never
              indicates future returns.
            </Disclaimer>
          </div>
        </Card>
      </div>
    </main>
  );
}