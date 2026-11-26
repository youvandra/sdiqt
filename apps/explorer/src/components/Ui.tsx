import { ArrowUpRight, Check, ChevronLeft, ChevronRight, Copy } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useMediaQuery } from "../lib/dom.ts";
import { num, shortHash, type Tone } from "../lib/format.ts";
import { pageCount, pageList } from "../lib/paging.ts";

export function Badge({
  tone,
  children,
  title,
}: {
  tone: Tone;
  children: ReactNode;
  title?: string | undefined;
}) {
  return (
    <span className="badge" data-tone={tone} title={title}>
      <span className="badge-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A long hex value: shortened, full value on hover, one-click copy. */
export function Hash({
  value,
  head = 8,
  tail = 6,
  href,
}: {
  value: string;
  head?: number;
  tail?: number;
  /** QoreChain Explorer page for this value, opened in a new tab. */
  href?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard can be blocked; the full value stays in the tooltip.
    }
  };
  return (
    <span className="hash" title={value}>
      {href ? (
        <a
          className="hash-text hash-link"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={`${value}, open on QoreChain Explorer`}
        >
          {shortHash(value, head, tail)}
          <ArrowUpRight size={12} aria-hidden="true" />
        </a>
      ) : (
        <span className="hash-text">{shortHash(value, head, tail)}</span>
      )}
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy"}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </span>
  );
}

/**
 * Status in a table cell. The normal state of a column is quiet text with a
 * dot; any other state gets a pill, so exceptions stand out in a long list.
 */
export function Status({
  tone,
  label,
  hint,
  quiet,
}: {
  tone: Tone;
  label: string;
  hint?: string | undefined;
  quiet: boolean;
}) {
  if (!quiet)
    return (
      <Badge tone={tone} title={hint}>
        {label}
      </Badge>
    );
  return (
    <span className="status" data-tone={tone} title={hint}>
      <span className="dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Eyebrow, heading and one-line lead. Left-aligned unless `center`. */
export function SectionHead(p: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  id?: string;
  center?: boolean;
  aside?: ReactNode;
}) {
  return (
    <div className="section-head" data-center={p.center === true}>
      <div className="section-head-text">
        <span className="eyebrow">{p.eyebrow}</span>
        <h2 className="t-h2" id={p.id}>
          {p.title}
        </h2>
        {p.children && <p className="t-body">{p.children}</p>}
      </div>
      {p.aside && <div className="section-head-aside">{p.aside}</div>}
    </div>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

export function Segmented<T extends string>(p: {
  label: string;
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a toggle group, a fieldset would add a legend and a border
    <div className="seg" role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={p.value === o.value}
          onClick={() => p.onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** "1-25 of 1,521" plus Previous, page numbers and Next. */
export function Pagination(p: {
  page: number;
  size: number;
  count: number;
  label: string;
  onPage: (page: number) => void;
}) {
  const pages = pageCount(p.count, p.size);
  // Phones show only the current page between first and last, so the row fits.
  const narrow = useMediaQuery("(max-width: 809px)");
  const from = p.count === 0 ? 0 : (p.page - 1) * p.size + 1;
  const to = Math.min(p.count, p.page * p.size);
  return (
    <nav className="pager" aria-label={p.label}>
      <span className="t-small pager-range">
        {num(from)}-{num(to)} of {num(p.count)}
      </span>
      {pages > 1 && (
        <div className="pager-pages">
          <button
            type="button"
            className="pager-btn"
            onClick={() => p.onPage(p.page - 1)}
            disabled={p.page === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          {pageList(p.page, pages, narrow ? 0 : 1).map((n, i) =>
            n === null ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: a gap has no identity of its own
              <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className="pager-btn"
                aria-current={n === p.page ? "page" : undefined}
                aria-label={`Page ${n}`}
                onClick={() => p.onPage(n)}
              >
                {num(n)}
              </button>
            ),
          )}
          <button
            type="button"
            className="pager-btn"
            onClick={() => p.onPage(p.page + 1)}
            disabled={p.page === pages}
            aria-label="Next page"
          >
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </nav>
  );
}
