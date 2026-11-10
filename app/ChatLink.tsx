import { ChatToggle } from "./InlineToggle";

// A round chat button that opens one chat right on the page (who can open it is checked on the server).
export default function ChatLink({
  chatKey,
  label,
  size = "sm",
}: {
  chatKey: string;
  label: string;
  size?: "sm" | "md";
}) {
  const className = `inline-flex shrink-0 items-center justify-center rounded-full text-thunder-blue ring-1 ring-thunder-blue/30 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-500/10 ${
    size === "md" ? "size-9" : "size-7"
  }`;
  const icon = (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className={size === "md" ? "size-5" : "size-4"}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
      />
    </svg>
  );
  // Opens the chat right on the page (put it in a wrapping row: the chat takes a line of its own).
  return (
    <ChatToggle chatKey={chatKey} label={label} className={className}>
      {icon}
    </ChatToggle>
  );
}
