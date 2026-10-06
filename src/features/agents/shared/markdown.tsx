import { useMemo, type ReactNode } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { Tooltip } from '@/components/ui/tooltip';
import { parseMarkdown, type Block, type Inline } from '@/lib/agents/markdown';
import { humanizeEntityType, parsePlaceholder } from '@/lib/knowledge/pii';
import { cn } from '@/lib/utils';
import { entityTone } from '@/features/knowledge/shared/pii-colors';

interface MarkdownProps {
  source: string;
  /** How an `[S1]` marker renders; plain text when not given. */
  renderCitation?: (tag: string) => ReactNode;
  /** Draw `[PERSON_1]` placeholders as chips (masked views, prompts). Default true. */
  placeholders?: boolean;
  /** A blinking caret after the last block while text is still arriving. */
  streaming?: boolean;
  className?: string;
}

/**
 * Model output, instructions and greetings as safe Markdown (spec §5 "Never render
 * … as raw HTML"): the text is parsed into a tree and rendered as React elements,
 * so no string ever reaches innerHTML. Links open in a new tab without a referrer.
 */
export function Markdown({ source, renderCitation, placeholders = true, streaming, className }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const context: RenderContext = { renderCitation, placeholders };
  return (
    <div className={cn('markdown text-[14px] leading-[1.7] break-words text-ink', className)}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} context={context} caret={streaming && index === blocks.length - 1} />
      ))}
      {streaming && blocks.length === 0 ? <Caret /> : null}
    </div>
  );
}

interface RenderContext {
  renderCitation?: (tag: string) => ReactNode;
  placeholders: boolean;
}

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1.05em] w-[7px] translate-y-[2px] animate-pulse rounded-[1px] bg-brand-500/70 motion-reduce:animate-none"
    />
  );
}

function BlockView({ block, context, caret }: { block: Block; context: RenderContext; caret?: boolean }) {
  const tail = caret ? <Caret /> : null;
  switch (block.type) {
    case 'paragraph':
      return (
        <p className="my-2 first:mt-0 last:mb-0">
          <Inlines nodes={block.children} context={context} />
          {tail}
        </p>
      );
    case 'heading': {
      const Tag = (`h${Math.min(block.level + 2, 6)}` as 'h3' | 'h4' | 'h5' | 'h6');
      return (
        <Tag
          className={cn(
            'mt-4 mb-1.5 font-semibold tracking-[-0.005em] text-ink first:mt-0',
            block.level <= 1 ? 'text-[16px]' : block.level === 2 ? 'text-[15px]' : 'text-[14px]',
          )}
        >
          <Inlines nodes={block.children} context={context} />
          {tail}
        </Tag>
      );
    }
    case 'code':
      return (
        <div className="my-3 overflow-hidden rounded-lg border border-line bg-[#faf9f6] first:mt-0 last:mb-0">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-1">
            <span className="font-mono text-[11px] text-faint">{block.lang ?? 'text'}</span>
            {block.open ? null : <CopyButton value={block.text} size="xs" variant="ghost" iconOnly label="Copy code" />}
          </div>
          <pre className="scrollbar-thin overflow-x-auto px-3.5 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink-soft">
            <code>{block.text}</code>
            {tail}
          </pre>
        </div>
      );
    case 'list': {
      const items = block.items.map((item, index) => (
        <li key={index} className="pl-1 [&>*:first-child]:mt-0 [&>p]:my-1">
          {item.map((child, childIndex) => (
            <BlockView
              key={childIndex}
              block={child}
              context={context}
              caret={caret && index === block.items.length - 1 && childIndex === item.length - 1}
            />
          ))}
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="my-2 list-decimal space-y-1 pl-6 marker:text-faint first:mt-0 last:mb-0">
          {items}
        </ol>
      ) : (
        <ul className="my-2 list-disc space-y-1 pl-6 marker:text-faint first:mt-0 last:mb-0">{items}</ul>
      );
    }
    case 'quote':
      return (
        <blockquote className="my-3 border-l-2 border-line-strong pl-3.5 text-ink-soft first:mt-0 last:mb-0">
          {block.children.map((child, index) => (
            <BlockView key={index} block={child} context={context} caret={caret && index === block.children.length - 1} />
          ))}
        </blockquote>
      );
    case 'rule':
      return <hr className="my-4 border-0 border-t border-line" />;
    case 'table':
      return (
        <div className="scrollbar-thin my-3 overflow-x-auto rounded-lg border border-line first:mt-0 last:mb-0">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-well/60">
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} scope="col" className="border-b border-line px-3 py-1.5 font-semibold text-ink" style={{ textAlign: block.align[index] ?? undefined }}>
                    <Inlines nodes={cell} context={context} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t border-line/70 first:border-t-0">
                  {row.map((cell, index) => (
                    <td key={index} className="px-3 py-1.5 align-top text-ink-soft" style={{ textAlign: block.align[index] ?? undefined }}>
                      <Inlines nodes={cell} context={context} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {tail}
        </div>
      );
  }
}

function Inlines({ nodes, context }: { nodes: readonly Inline[]; context: RenderContext }) {
  return (
    <>
      {nodes.map((node, index) => (
        <InlineView key={index} node={node} context={context} />
      ))}
    </>
  );
}

function InlineView({ node, context }: { node: Inline; context: RenderContext }) {
  switch (node.type) {
    case 'text':
      return <>{node.text}</>;
    case 'break':
      return <br />;
    case 'strong':
      return (
        <strong className="font-semibold text-ink">
          <Inlines nodes={node.children} context={context} />
        </strong>
      );
    case 'em':
      return (
        <em>
          <Inlines nodes={node.children} context={context} />
        </em>
      );
    case 'del':
      return (
        <del className="text-muted">
          <Inlines nodes={node.children} context={context} />
        </del>
      );
    case 'code':
      return <code className="rounded-[4px] border border-line bg-well/70 px-1 py-px font-mono text-[12.5px] text-ink-soft">{node.text}</code>;
    case 'link':
      return (
        <a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer"
          className="rounded-sm text-brand-700 underline decoration-brand-200 underline-offset-[3px] hover:decoration-brand-500"
          title={node.href}
        >
          <Inlines nodes={node.children} context={context} />
        </a>
      );
    case 'citation':
      return context.renderCitation ? <>{context.renderCitation(node.tag)}</> : <>[{node.tag}]</>;
    case 'placeholder':
      return context.placeholders ? <PlaceholderChip placeholder={node.text} /> : <>{node.text}</>;
  }
}

/** A masked value as the model saw it: `[EMAIL_ADDRESS_1]` drawn as a coloured chip. */
export function PlaceholderChip({ placeholder, className }: { placeholder: string; className?: string }) {
  const parsed = parsePlaceholder(placeholder);
  const type = parsed?.type ?? 'CUSTOM';
  const tone = entityTone(type);
  const label = humanizeEntityType(type);
  return (
    <Tooltip content={`Masked ${label.toLowerCase()}: the model only ever sees this placeholder.`}>
      <span
        tabIndex={0}
        className={cn(
          'mx-px inline-flex items-center gap-1 rounded-[5px] border px-1 align-baseline font-mono text-[11px] leading-[1.45] font-semibold tracking-[0.02em] outline-offset-1',
          tone.chip,
          className,
        )}
      >
        <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
        {placeholder.slice(1, -1)}
        <span className="sr-only"> (masked {label})</span>
      </span>
    </Tooltip>
  );
}

