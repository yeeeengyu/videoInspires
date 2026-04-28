"use client";

import {
  Bot,
  Database,
  Loader2,
  MessageSquareText,
  RefreshCcw,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

type Role = "user" | "assistant" | "system";

type ChatMessage = {
  role: Role;
  content: string;
};

type RetrievedContext = {
  id: string;
  title: string;
  source: string | null;
  content: string;
  distance: number | null;
};

type DocumentSummary = {
  id: string;
  title: string;
  source: string | null;
  preview: string;
};

const starterMessages: ChatMessage[] = [
  {
    role: "assistant",
    content:
      "안녕하세요. AI 관련 영상을 학생들이 쉽게 이해할 수 있도록 시나리오로 구성해드릴게요. 주제, 대상 학년, 영상 길이를 알려주시면 장면별 대본까지 만들어드립니다.",
  },
];

function parseSseChunk(buffer: string) {
  const events = buffer.split("\n\n");
  const remainder = events.pop() ?? "";

  return {
    remainder,
    events: events
      .map((raw) => {
        const event = raw
          .split("\n")
          .find((line) => line.startsWith("event: "))
          ?.replace("event: ", "")
          .trim();
        const data = raw
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.replace("data: ", "");

        if (!event || !data) {
          return null;
        }

        return { event, data: JSON.parse(data) as unknown };
      })
      .filter(Boolean) as Array<{ event: string; data: unknown }>,
  };
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [input, setInput] = useState("");
  const [useRag, setUseRag] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [contexts, setContexts] = useState<RetrievedContext[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [docTitle, setDocTitle] = useState("");
  const [docSource, setDocSource] = useState("");
  const [docText, setDocText] = useState("");
  const [isIndexing, setIsIndexing] = useState(false);
  const [notice, setNotice] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const visibleMessages = useMemo(() => messages.filter((message) => message.role !== "system"), [messages]);

  async function refreshDocuments() {
    const response = await fetch(`${API_BASE}/api/documents`);
    if (!response.ok) {
      throw new Error("문서 목록을 불러오지 못했습니다.");
    }
    setDocuments((await response.json()) as DocumentSummary[]);
  }

  useEffect(() => {
    refreshDocuments().catch(() => setNotice("백엔드 연결을 확인해주세요."));
  }, []);

  useLayoutEffect(() => {
    const chatScroll = chatScrollRef.current;
    if (!chatScroll) {
      return;
    }

    const scrollToBottom = () => {
      chatScroll.scrollTop = chatScroll.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: "end" });
    };

    scrollToBottom();
    const firstFrame = requestAnimationFrame(scrollToBottom);
    const secondFrame = requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [messages, isStreaming]);

  async function submitChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question || isStreaming) {
      return;
    }

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: question }, { role: "assistant", content: "" }];
    setMessages(nextMessages);
    setInput("");
    setContexts([]);
    setIsStreaming(true);
    setNotice("");

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.filter((message) => message.content.trim() && message.role !== "assistant").slice(-8),
          use_rag: useRag,
          temperature: 0.3,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error("스트리밍 응답을 시작하지 못했습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.remainder;

        for (const item of parsed.events) {
          if (item.event === "context") {
            setContexts(item.data as RetrievedContext[]);
          }
          if (item.event === "token") {
            const token = (item.data as { content: string }).content;
            setMessages((current) => {
              const copy = [...current];
              const last = copy[copy.length - 1];
              copy[copy.length - 1] = { ...last, content: last.content + token };
              return copy;
            });
          }
          if (item.event === "error") {
            throw new Error((item.data as { message: string }).message);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      setNotice(message);
      setMessages((current) => {
        const copy = [...current];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = {
          ...last,
          content: last.content || `오류가 발생했습니다: ${message}`,
        };
        return copy;
      });
    } finally {
      setIsStreaming(false);
    }
  }

  async function ingestDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!docText.trim() || isIndexing) {
      return;
    }

    setIsIndexing(true);
    setNotice("");
    try {
      const response = await fetch(`${API_BASE}/api/ingest/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: docTitle.trim() || "Untitled",
          source: docSource.trim() || null,
          text: docText.trim(),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail);
      }

      setDocTitle("");
      setDocSource("");
      setDocText("");
      await refreshDocuments();
      setNotice("문서가 벡터DB에 인덱싱되었습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "인덱싱에 실패했습니다.");
    } finally {
      setIsIndexing(false);
    }
  }

  async function clearDocuments() {
    await fetch(`${API_BASE}/api/documents`, { method: "DELETE" });
    setDocuments([]);
    setContexts([]);
    setNotice("벡터DB 문서를 비웠습니다.");
  }

  return (
    <main className="min-h-screen px-5 py-6 text-neutral-950 lg:h-screen lg:overflow-hidden lg:px-8">
      <div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-neutral-900/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-900/15 bg-white/65 px-3 py-1 text-sm font-medium text-emerald-950 shadow-sm">
              <Sparkles size={16} />
              vLLM + FastAPI SSE + FAISS RAG
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-neutral-950 md:text-5xl">
              로컬 LLM을 위한 RAG 채팅 워크벤치
            </h1>
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <StatusPill label="LLM" value="vLLM" />
            <StatusPill label="Stream" value="SSE" />
            <StatusPill label="Vector" value="FAISS" />
          </div>
        </header>

        {notice ? (
          <div className="rounded-md border border-neutral-900/10 bg-white/80 px-4 py-3 text-sm text-neutral-800 shadow-sm">
            {notice}
          </div>
        ) : null}

        <section className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
          <div className="flex min-h-[620px] flex-col overflow-hidden rounded-lg border border-neutral-900/10 bg-white/76 shadow-xl shadow-neutral-900/5 backdrop-blur lg:min-h-0">
            <div className="flex items-center justify-between border-b border-neutral-900/10 px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <MessageSquareText size={19} />
                Chat
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
                <span>RAG</span>
                <input
                  checked={useRag}
                  className="h-4 w-4 accent-emerald-800"
                  type="checkbox"
                  onChange={(event) => setUseRag(event.target.checked)}
                />
              </label>
            </div>

            <div ref={chatScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
              {visibleMessages.map((message, index) => (
                <ChatBubble key={`${message.role}-${index}`} message={message} streaming={isStreaming && index === visibleMessages.length - 1} />
              ))}
              <div ref={bottomRef} />
            </div>

            <form className="border-t border-neutral-900/10 bg-white/70 p-3" onSubmit={submitChat}>
              <div className="flex items-end gap-2">
                <textarea
                  className="min-h-16 flex-1 resize-none rounded-md border border-neutral-900/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-800 focus:ring-4 focus:ring-emerald-900/10"
                  placeholder="예: 중학생 대상 3분짜리 생성형 AI 소개 영상 시나리오를 만들어줘"
                  rows={2}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  aria-label="Send message"
                  className="grid h-12 w-12 place-items-center rounded-md bg-neutral-950 text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isStreaming || !input.trim()}
                  type="submit"
                  title="Send"
                >
                  {isStreaming ? <Loader2 className="animate-spin" size={19} /> : <Send size={19} />}
                </button>
              </div>
            </form>
          </div>

          <aside className="grid gap-5 lg:grid-rows-[auto_minmax(0,1fr)]">
            <form className="rounded-lg border border-neutral-900/10 bg-white/76 p-4 shadow-xl shadow-neutral-900/5 backdrop-blur" onSubmit={ingestDocument}>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <Upload size={18} />
                  Ingest
                </div>
                <button
                  aria-label="Refresh documents"
                  className="grid h-9 w-9 place-items-center rounded-md border border-neutral-900/10 bg-white text-neutral-700 transition hover:border-emerald-900/30 hover:text-emerald-900"
                  type="button"
                  title="Refresh documents"
                  onClick={() => refreshDocuments().catch(() => setNotice("문서 목록 새로고침에 실패했습니다."))}
                >
                  <RefreshCcw size={16} />
                </button>
              </div>
              <div className="space-y-3">
                <input
                  className="w-full rounded-md border border-neutral-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-4 focus:ring-emerald-900/10"
                  placeholder="문서 제목"
                  value={docTitle}
                  onChange={(event) => setDocTitle(event.target.value)}
                />
                <input
                  className="w-full rounded-md border border-neutral-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-4 focus:ring-emerald-900/10"
                  placeholder="출처 URL 또는 메모"
                  value={docSource}
                  onChange={(event) => setDocSource(event.target.value)}
                />
                <textarea
                  className="min-h-36 w-full resize-none rounded-md border border-neutral-900/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-800 focus:ring-4 focus:ring-emerald-900/10"
                  placeholder="RAG에 넣을 텍스트"
                  value={docText}
                  onChange={(event) => setDocText(event.target.value)}
                />
                <button
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-emerald-900 px-4 text-sm font-semibold text-white transition hover:bg-emerald-950 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isIndexing || !docText.trim()}
                  type="submit"
                >
                  {isIndexing ? <Loader2 className="animate-spin" size={17} /> : <Database size={17} />}
                  Index to VectorDB
                </button>
              </div>
            </form>

            <div className="min-h-0 rounded-lg border border-neutral-900/10 bg-white/76 p-4 shadow-xl shadow-neutral-900/5 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2 font-semibold">
                  <Database size={18} />
                  Knowledge
                </div>
                <button
                  aria-label="Clear vector database"
                  className="grid h-9 w-9 place-items-center rounded-md border border-neutral-900/10 bg-white text-neutral-700 transition hover:border-red-900/30 hover:text-red-800"
                  type="button"
                  title="Clear vector database"
                  onClick={clearDocuments}
                >
                  <Trash2 size={16} />
                </button>
              </div>

              <div className="mb-4 space-y-2">
                <h2 className="text-sm font-semibold text-neutral-700">Retrieved context</h2>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {contexts.length ? (
                    contexts.map((item) => <ContextItem key={item.id} item={item} />)
                  ) : (
                    <p className="rounded-md border border-dashed border-neutral-900/15 px-3 py-4 text-sm text-neutral-500">
                      검색된 컨텍스트가 여기에 표시됩니다.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h2 className="text-sm font-semibold text-neutral-700">Indexed documents</h2>
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {documents.length ? (
                    documents.map((document) => <DocumentItem key={document.id} document={document} />)
                  ) : (
                    <p className="rounded-md border border-dashed border-neutral-900/15 px-3 py-4 text-sm text-neutral-500">
                      아직 인덱싱된 문서가 없습니다.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-900/10 bg-white/70 px-3 py-2 shadow-sm">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className="font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

function ChatBubble({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-emerald-900 text-white">
          <Bot size={18} />
        </div>
      ) : null}
      <div
        className={`max-w-[82%] rounded-lg px-4 py-3 text-sm leading-6 shadow-sm ${
          isUser ? "bg-neutral-950 text-white" : "border border-neutral-900/10 bg-white text-neutral-900"
        }`}
      >
        {isUser ? <div className="whitespace-pre-wrap">{message.content}</div> : <MarkdownContent content={message.content} />}
        {streaming && !message.content ? <Loader2 className="animate-spin" size={16} /> : null}
      </div>
      {isUser ? (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-rose-800 text-white">
          <UserRound size={18} />
        </div>
      ) : null}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  if (!content) {
    return null;
  }

  const blocks = splitCodeFences(content);

  return (
    <div className="markdown-content">
      {blocks.map((block, index) =>
        block.type === "code" ? (
          <pre key={`code-${index}`} className="overflow-x-auto rounded-md bg-neutral-950 px-3 py-2 text-xs leading-5 text-neutral-50">
            <code>{block.code}</code>
          </pre>
        ) : (
          <MarkdownText key={`text-${index}`} text={block.text} />
        ),
      )}
    </div>
  );
}

type MarkdownBlock = { type: "text"; text: string } | { type: "code"; code: string; language: string };

function splitCodeFences(content: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const pattern = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    if (match.index > cursor) {
      blocks.push({ type: "text", text: content.slice(cursor, match.index) });
    }
    blocks.push({ type: "code", language: match[1] ?? "", code: match[2] ?? "" });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    blocks.push({ type: "text", text: content.slice(cursor) });
  }

  return blocks;
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;

  function addParagraph(start: number) {
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index], lines[index + 1])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) {
      nodes.push(
        <p key={`p-${start}`} className="my-2">
          {renderInline(paragraph.join(" "))}
        </p>,
      );
    }
  }

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    const key = `${index}-${trimmed.slice(0, 12)}`;

    if (!trimmed) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      nodes.push(
        <MarkdownHeading key={`heading-${key}`} level={Math.min(heading[1].length + 1, 5)}>
          {renderInline(heading[2])}
        </MarkdownHeading>,
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quote.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote key={`quote-${key}`} className="my-3 border-l-4 border-emerald-800/35 pl-3 text-neutral-700">
          {renderInline(quote.join(" "))}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ul key={`ul-${key}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      nodes.push(
        <ol key={`ol-${key}`} className="my-2 list-decimal space-y-1 pl-5">
          {items.map((item, itemIndex) => (
            <li key={`${item}-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    if (isTableStart(line, lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      nodes.push(<MarkdownTable key={`table-${key}`} lines={tableLines} />);
      continue;
    }

    addParagraph(index);
  }

  return <>{nodes}</>;
}

function MarkdownHeading({ level, children }: { level: number; children: ReactNode }) {
  const className = "mb-2 mt-4 font-semibold leading-7 text-neutral-950";

  if (level <= 2) {
    return <h2 className={className}>{children}</h2>;
  }
  if (level === 3) {
    return <h3 className={className}>{children}</h3>;
  }
  if (level === 4) {
    return <h4 className={className}>{children}</h4>;
  }
  return <h5 className={className}>{children}</h5>;
}

function isBlockStart(line: string, nextLine?: string) {
  const trimmed = line.trim();
  return (
    /^(#{1,4})\s+/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    isTableStart(line, nextLine)
  );
}

function isTableStart(line: string, nextLine?: string) {
  return Boolean(line.includes("|") && nextLine && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine));
}

function MarkdownTable({ lines }: { lines: string[] }) {
  const [headerLine, , ...rowLines] = lines;
  const headers = splitTableRow(headerLine);
  const rows = rowLines.map(splitTableRow);

  return (
    <div className="my-3 overflow-x-auto rounded-md border border-neutral-900/10">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-neutral-100 text-neutral-800">
          <tr>
            {headers.map((header, index) => (
              <th key={`${header}-${index}`} className="border-b border-neutral-900/10 px-3 py-2 font-semibold">
                {renderInline(header)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="border-t border-neutral-900/10">
              {headers.map((_, cellIndex) => (
                <td key={`cell-${rowIndex}-${cellIndex}`} className="px-3 py-2 align-top">
                  {renderInline(row[cellIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;

    if (token.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-neutral-900/5 px-1 py-0.5 text-[0.92em] text-emerald-950">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link ? safeHref(link[2]) : null;
      nodes.push(
        href ? (
          <a key={key} className="font-medium text-emerald-800 underline underline-offset-2" href={href} rel="noreferrer" target="_blank">
            {link?.[1]}
          </a>
        ) : (
          token
        ),
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function safeHref(href: string) {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  return null;
}

function ContextItem({ item }: { item: RetrievedContext }) {
  return (
    <article className="rounded-md border border-neutral-900/10 bg-white px-3 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{item.title}</h3>
        {item.distance !== null ? <span className="text-xs text-neutral-500">{item.distance.toFixed(3)}</span> : null}
      </div>
      <p className="line-clamp-3 text-xs leading-5 text-neutral-600">{item.content}</p>
    </article>
  );
}

function DocumentItem({ document }: { document: DocumentSummary }) {
  return (
    <article className="rounded-md border border-neutral-900/10 bg-white px-3 py-2">
      <h3 className="truncate text-sm font-semibold">{document.title}</h3>
      {document.source ? <p className="truncate text-xs text-emerald-900">{document.source}</p> : null}
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-neutral-600">{document.preview}</p>
    </article>
  );
}
