"use client";

import * as React from "react";
import { api, type Instrument } from "@/lib/api";

/*
 * The instrument book is static for the life of the page, so it is fetched
 * once and shared by every SymbolInput instead of once per field.
 */
let instrumentsPromise: Promise<Instrument[]> | null = null;

function loadInstruments(): Promise<Instrument[]> {
  if (!instrumentsPromise) {
    instrumentsPromise = api
      .instruments()
      .then((response) => response.instruments)
      .catch((error: unknown) => {
        instrumentsPromise = null; // allow a retry on the next mount
        throw error;
      });
  }
  return instrumentsPromise;
}

export function useInstrumentList(): Instrument[] {
  const [items, setItems] = React.useState<Instrument[]>([]);
  React.useEffect(() => {
    let active = true;
    loadInstruments()
      .then((list) => active && setItems(list))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return items;
}

type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list">;

/**
 * Symbol field with autocomplete over the real instrument book.
 *
 * `onChange` receives every keystroke (the draft). `onCommit` fires only when
 * the user settles on a value — picking a suggestion, pressing Enter, or
 * leaving the field — so pages that fetch on change never query half-typed
 * names such as "IC", which the API cannot resolve.
 */
export function SymbolInput({
  value,
  onChange,
  onCommit,
  className = "input",
  ...rest
}: InputProps & {
  value: string;
  onChange: (value: string) => void;
  onCommit?: (symbol: string) => void;
}) {
  const instruments = useInstrumentList();
  const listId = React.useId();
  const known = React.useMemo(() => new Set(instruments.map((item) => item.symbol)), [instruments]);

  const commit = (raw: string) => {
    const next = raw.trim().toUpperCase();
    if (next) onCommit?.(next);
  };

  return (
    <>
      <input
        {...rest}
        className={className}
        value={value}
        list={listId}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          const next = event.target.value.toUpperCase();
          onChange(next);
          // Choosing an entry from the suggestion list commits immediately.
          if (known.has(next.trim())) commit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(value);
          rest.onKeyDown?.(event);
        }}
        onBlur={(event) => {
          commit(value);
          rest.onBlur?.(event);
        }}
      />
      <datalist id={listId}>
        {instruments.map((item) => (
          <option key={item.symbol} value={item.symbol}>
            {item.name}
          </option>
        ))}
      </datalist>
    </>
  );
}
