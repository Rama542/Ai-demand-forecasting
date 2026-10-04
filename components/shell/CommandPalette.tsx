"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { useDebounced } from "@/lib/hooks";
import { api, type Instrument } from "@/lib/api";
import { NAV } from "./AppShell";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Row {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: Parameters<typeof Icon>[0]["name"];
  run: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const [instruments, setInstruments] = React.useState<Instrument[]>([]);
  const [mounted, setMounted] = React.useState(false);
  const debounced = useDebounced(query, 200);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setMounted(true), []);

  /* Load the instrument list once, when the palette first opens. */
  React.useEffect(() => {
    if (!open || instruments.length > 0) return;
    const controller = new AbortController();
    api
      .instruments(controller.signal)
      .then((response) => setInstruments(response.instruments))
      .catch(() => setInstruments([]));
    return () => controller.abort();
  }, [open, instruments.length]);

  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
  }, [open]);

  const rows = React.useMemo<Row[]>(() => {
    const pages: Row[] = NAV.flatMap((section) =>
      section.items.map((item) => ({
        id: `page:${item.href}`,
        label: item.label,
        hint: "Go to page",
        group: "Pages",
        icon: item.icon,
        run: () => router.push(item.href),
      })),
    );

    const term = debounced.trim().toLowerCase();
    if (!term) return pages.slice(0, 8);

    const symbols: Row[] = instruments
      .filter(
        (item) =>
          item.symbol.toLowerCase().includes(term) ||
          item.name.toLowerCase().includes(term) ||
          item.sector.toLowerCase().includes(term),
      )
      .slice(0, 10)
      .map((item) => ({
        id: `sym:${item.symbol}`,
        label: `${item.symbol} — ${item.name}`,
        hint: `${item.kind} · ${item.sector}`,
        group: "Instruments",
        icon: "chart",
        run: () => router.push(`/research?symbol=${encodeURIComponent(item.symbol)}`),
      }));

    const matchedPages = pages.filter(
      (page) => page.label.toLowerCase().includes(term) || page.group.toLowerCase().includes(term),
    );

    return [...symbols, ...matchedPages].slice(0, 16);
  }, [debounced, instruments, router]);

  React.useEffect(() => setCursor(0), [debounced]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((c) => Math.min(rows.length - 1, c + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((c) => Math.max(0, c - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        rows[cursor]?.run();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, rows, cursor, onClose]);

  React.useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!mounted || !open) return null;

  let lastGroup = "";

  return createPortal(
    <div
      className="overlay center"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="palette">
        <div className="palette-input">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search instruments or pages…"
            aria-label="Search"
            spellCheck={false}
          />
          <kbd
            style={{
              fontSize: 9,
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              padding: "2px 5px",
              color: "var(--text-tertiary)",
            }}
          >
            ESC
          </kbd>
        </div>

        <div className="palette-results" ref={listRef}>
          {rows.length === 0 ? (
            <p className="faint" style={{ padding: "var(--sp-6)", textAlign: "center", fontSize: "var(--text-sm)" }}>
              No matches for “{debounced}”.
            </p>
          ) : (
            rows.map((row, index) => {
              const header = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              return (
                <React.Fragment key={row.id}>
                  {header ? <div className="palette-group">{header}</div> : null}
                  <button
                    type="button"
                    data-active={index === cursor}
                    className={`palette-item${index === cursor ? " active" : ""}`}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => {
                      row.run();
                      onClose();
                    }}
                  >
                    <Icon name={row.icon} />
                    <span className="grow truncate">{row.label}</span>
                    {row.hint ? <span className="faint" style={{ fontSize: "var(--text-xs)" }}>{row.hint}</span> : null}
                  </button>
                </React.Fragment>
              );
            })
          )}
        </div>

        <div className="palette-foot">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}