import { QuoteCard } from "./QuoteCard";
import { PortfolioSummary } from "./PortfolioSummary";

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  type: "text" | "quote" | "portfolio" | "error";
  data?: Record<string, unknown>;
  timestamp: number;
}

export function ChatMessage({
  role,
  content,
  type,
  data,
  timestamp,
}: ChatMessageProps) {
  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`mb-2.5 flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={joinClasses(
          "max-w-[85%] px-3 py-2",
          isUser
            ? "terminal-theme-card border-[#8ccfe3] bg-[linear-gradient(180deg,rgba(237,250,255,0.98)_0%,rgba(222,246,252,0.96)_100%)]"
            : "terminal-theme-card",
        )}
      >
        {type === "error" ? (
          <p className="text-sm text-red-400 whitespace-pre-wrap">{content}</p>
        ) : (
          <p className="text-sm text-terminal-text whitespace-pre-wrap">
            {content}
          </p>
        )}

        {type === "quote" && data && (
          <div className="mt-2">
            <QuoteCard data={data} />
          </div>
        )}

        {type === "portfolio" && data && (
          <div className="mt-2">
            <PortfolioSummary data={data} />
          </div>
        )}

        <span className="mt-1 block select-none text-[10px] text-terminal-text-muted">
          {time}
        </span>
      </div>
    </div>
  );
}
