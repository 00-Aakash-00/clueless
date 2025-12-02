import type React from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { dracula } from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
	content: string;
	className?: string;
	variant?: "glass" | "dark" | "light";
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
	content,
	className = "",
	variant = "dark",
}) => {
	const proseClass =
		variant === "glass"
			? "prose-glass"
			: variant === "dark"
				? "prose-dark"
				: "";

	return (
		<div className={`${proseClass} ${className}`}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				rehypePlugins={[rehypeRaw]}
				components={{
					code({ node, className: codeClassName, children, ...props }) {
						const match = /language-(\w+)/.exec(codeClassName || "");
						const isInline = !match && !String(children).includes("\n");

						return !isInline && match ? (
							<SyntaxHighlighter
								style={dracula}
								language={match[1]}
								PreTag="div"
								customStyle={{
									margin: "0.5em 0",
									borderRadius: "8px",
									fontSize: "0.85em",
								}}
							>
								{String(children).replace(/\n$/, "")}
							</SyntaxHighlighter>
						) : (
							<code className={codeClassName} {...props}>
								{children}
							</code>
						);
					},
					// Custom paragraph to avoid nesting issues
					p({ children }) {
						return <p style={{ marginBottom: "0.5em" }}>{children}</p>;
					},
					// Custom list styling
					ul({ children }) {
						return (
							<ul style={{ paddingLeft: "1.5em", marginBottom: "0.5em" }}>
								{children}
							</ul>
						);
					},
					ol({ children }) {
						return (
							<ol style={{ paddingLeft: "1.5em", marginBottom: "0.5em" }}>
								{children}
							</ol>
						);
					},
					// Custom headings
					h1({ children }) {
						return (
							<h1
								style={{
									fontSize: "1.25em",
									fontWeight: 600,
									marginTop: "0.75em",
									marginBottom: "0.5em",
								}}
							>
								{children}
							</h1>
						);
					},
					h2({ children }) {
						return (
							<h2
								style={{
									fontSize: "1.1em",
									fontWeight: 600,
									marginTop: "0.75em",
									marginBottom: "0.5em",
								}}
							>
								{children}
							</h2>
						);
					},
					h3({ children }) {
						return (
							<h3
								style={{
									fontSize: "1em",
									fontWeight: 600,
									marginTop: "0.5em",
									marginBottom: "0.25em",
								}}
							>
								{children}
							</h3>
						);
					},
					// Custom blockquote
					blockquote({ children }) {
						return (
							<blockquote
								style={{
									borderLeft: "3px solid rgba(255, 255, 255, 0.3)",
									paddingLeft: "1em",
									marginLeft: 0,
									fontStyle: "italic",
									opacity: 0.9,
								}}
							>
								{children}
							</blockquote>
						);
					},
					// Custom links
					a({ href, children }) {
						return (
							<a
								href={href}
								target="_blank"
								rel="noopener noreferrer"
								style={{
									color: "rgba(147, 197, 253, 1)",
									textDecoration: "underline",
								}}
							>
								{children}
							</a>
						);
					},
					// Custom strong/bold
					strong({ children }) {
						return <strong style={{ fontWeight: 600 }}>{children}</strong>;
					},
					// Table components
					table({ children }) {
						return (
							<div style={{ overflowX: "auto", margin: "0.75em 0" }}>
								<table
									style={{
										width: "100%",
										borderCollapse: "collapse",
										fontSize: "0.9em",
										borderRadius: "8px",
										overflow: "hidden",
									}}
								>
									{children}
								</table>
							</div>
						);
					},
					thead({ children }) {
						return (
							<thead style={{ background: "rgba(0, 0, 0, 0.2)" }}>
								{children}
							</thead>
						);
					},
					tbody({ children }) {
						return <tbody>{children}</tbody>;
					},
					tr({ children }) {
						return (
							<tr
								style={{
									borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
								}}
							>
								{children}
							</tr>
						);
					},
					th({ children }) {
						return (
							<th
								style={{
									padding: "0.75em 1em",
									textAlign: "left",
									fontWeight: 600,
									color: "rgba(255, 255, 255, 0.95)",
								}}
							>
								{children}
							</th>
						);
					},
					td({ children }) {
						return (
							<td
								style={{
									padding: "0.75em 1em",
									color: "rgba(255, 255, 255, 0.85)",
								}}
							>
								{children}
							</td>
						);
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
};

export default MarkdownRenderer;
