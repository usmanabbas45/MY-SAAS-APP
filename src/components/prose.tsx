import Link from "next/link";
import { Fragment } from "react";

/**
 * Tiny, safe renderer for the blog's Markdown subset: ## / ### headings, paragraphs, "- " and "1. " lists,
 * "> " callouts, **bold** and [links](/path). Text is rendered by React, so nothing is injected as HTML.
 */
function inline(text: string, keyBase: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${keyBase}-${i++}`}>{m[1]}</strong>);
    else if (m[3].startsWith("/")) out.push(<Link key={`${keyBase}-${i++}`} href={m[3]}>{m[2]}</Link>);
    else out.push(<a key={`${keyBase}-${i++}`} href={m[3]} target="_blank" rel="noopener">{m[2]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function Prose({ source }: { source: string }) {
  const blocks = source.trim().split(/\n\s*\n/);
  return (
    <>
      {blocks.map((raw, b) => {
        const block = raw.trim();
        const k = `b${b}`;
        if (block.startsWith("### ")) return <h3 key={k} id={slugify(block.slice(4))}>{inline(block.slice(4), k)}</h3>;
        if (block.startsWith("## ")) return <h2 key={k} id={slugify(block.slice(3))}>{inline(block.slice(3), k)}</h2>;
        const lines = block.split("\n").map((l) => l.trim());
        if (lines.every((l) => l.startsWith("- "))) return <ul key={k}>{lines.map((l, i) => <li key={i}>{inline(l.slice(2), `${k}-${i}`)}</li>)}</ul>;
        if (lines.every((l) => /^\d+\.\s/.test(l))) return <ol key={k}>{lines.map((l, i) => <li key={i}>{inline(l.replace(/^\d+\.\s/, ""), `${k}-${i}`)}</li>)}</ol>;
        if (lines.every((l) => l.startsWith("> "))) return <div key={k} className="callout">{lines.map((l, i) => <Fragment key={i}>{inline(l.slice(2), `${k}-${i}`)}{i < lines.length - 1 ? <br /> : null}</Fragment>)}</div>;
        return <p key={k}>{inline(lines.join(" "), k)}</p>;
      })}
    </>
  );
}

/** Headings of a Markdown source, for a table of contents. */
export function headings(source: string): { id: string; text: string }[] {
  return source.split("\n").filter((l) => l.startsWith("## ")).map((l) => ({ id: slugify(l.slice(3)), text: l.slice(3).replace(/\*\*/g, "") }));
}
