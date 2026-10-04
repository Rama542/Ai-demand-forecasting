"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { Button } from "./index";

function useMounted() {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  return mounted;
}

/** Close on Escape and lock body scroll while open. */
function useDismiss(open: boolean, onClose: () => void) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, description, children, footer, wide }: ModalProps) {
  const mounted = useMounted();
  useDismiss(open, onClose);
  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="overlay center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={["modal", wide && "modal-wide"].filter(Boolean).join(" ")}>
        <header className="modal-head">
          <div>
            <h2>{title}</h2>
            {description ? <p className="card-sub">{description}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" />
          </Button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const mounted = useMounted();
  useDismiss(open, onClose);
  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="overlay right"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside className="drawer">
        <header className="modal-head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close panel">
            <Icon name="x" />
          </Button>
        </header>
        <div className="modal-body grow">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </aside>
    </div>,
    document.body,
  );
}