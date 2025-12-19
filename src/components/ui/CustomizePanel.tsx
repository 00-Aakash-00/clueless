import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	IoAdd,
	IoChevronDown,
	IoChevronForward,
	IoClose,
	IoCloudUpload,
	IoCreate,
	IoDocumentText,
	IoLink,
	IoPersonCircle,
	IoRefresh,
	IoSettings,
	IoSync,
	IoTrash,
	IoWarning,
} from "react-icons/io5";

interface CustomizePanelProps {
	onClose?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
	default: "Default Assistant",
	meeting_assistant: "Meeting Assistant",
	technical_expert: "Technical Expert",
	creative_writer: "Creative Writer",
	research_analyst: "Research Analyst",
	custom: "Custom Role...",
};

type TabKey = "knowledge" | "integrations" | "personal";

type UploadPhase = "preparing" | "uploading" | "processing" | "ready" | "failed";

type UploadTask = {
	localId: string;
	name: string;
	size: number;
	mimeType?: string;
	phase: UploadPhase;
	status?: string;
	supermemoryId?: string;
	error?: string;
	startedAt: number;
	updatedAt: number;
};

const PROVIDERS: Array<{
	id: SupermemoryProvider;
	label: string;
	description: string;
}> = [
	{
		id: "notion",
		label: "Notion",
		description: "Sync pages and databases into your knowledge base.",
	},
	{
		id: "google-drive",
		label: "Google Drive",
		description: "Import Docs, Sheets, Slides, PDFs, and more.",
	},
	{
		id: "onedrive",
		label: "OneDrive",
		description: "Sync files from OneDrive and Microsoft 365.",
	},
];

const Section: React.FC<{
	title: string;
	icon: React.ReactNode;
	children: React.ReactNode;
	defaultOpen?: boolean;
	badge?: number;
}> = ({ title, icon, children, defaultOpen = false, badge }) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);
	return (
		<div className="border-b border-white/10 last:border-b-0">
			<button
				type="button"
				onClick={() => setIsOpen((v) => !v)}
				className="w-full flex items-center justify-between py-3 px-1 text-left hover:bg-white/5 transition-colors rounded-lg"
			>
				<div className="flex items-center gap-2 min-w-0">
					<span className="text-white/60">{icon}</span>
					<span className="text-xs font-medium text-white/80 truncate">
						{title}
					</span>
					{badge !== undefined && badge > 0 && (
						<span className="text-[10px] bg-white/20 text-white/70 px-1.5 py-0.5 rounded-full flex-shrink-0">
							{badge}
						</span>
					)}
				</div>
				{isOpen ? (
					<IoChevronDown className="w-4 h-4 text-white/50 flex-shrink-0" />
				) : (
					<IoChevronForward className="w-4 h-4 text-white/50 flex-shrink-0" />
				)}
			</button>
			{isOpen && <div className="pb-3 px-1">{children}</div>}
		</div>
	);
};

const FileDropZone: React.FC<{
	accept: string;
	multiple?: boolean;
	disabled?: boolean;
	helperText: string;
	buttonLabel?: string;
	onFilesSelected: (files: FileList | null) => void;
}> = ({
	accept,
	multiple = false,
	disabled = false,
	helperText,
	buttonLabel = "Browse",
	onFilesSelected,
}) => {
	const [isDragOver, setIsDragOver] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		if (disabled) return;
		setIsDragOver(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragOver(false);
		if (disabled) return;
		onFilesSelected(e.dataTransfer.files);
	};

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		onFilesSelected(e.target.files);
		e.currentTarget.value = "";
	};

	return (
		<div
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			className={`border border-dashed rounded-md p-3 text-center transition-colors ${
				isDragOver ? "border-white/50 bg-white/10" : "border-white/20"
			}`}
		>
			<input
				ref={inputRef}
				type="file"
				multiple={multiple}
				onChange={handleChange}
				className="hidden"
				accept={accept}
				disabled={disabled}
			/>
			<IoCloudUpload className="w-5 h-5 mx-auto text-white/40 mb-1" />
			<p className="text-[10px] text-white/50 mb-2">{helperText}</p>
			<button
				type="button"
				onClick={() => inputRef.current?.click()}
				disabled={disabled}
				className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
			>
				{buttonLabel}
			</button>
		</div>
	);
};

const formatDocTitle = (doc: ListedDocument): string => {
	const title = typeof doc.title === "string" ? doc.title.trim() : "";
	if (title) return title;
	const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
	const filename = typeof metadata.filename === "string" ? metadata.filename : "";
	if (filename) return filename;
	return doc.id;
};

const formatDocSubtitle = (doc: ListedDocument): string => {
	const status = typeof doc.status === "string" ? doc.status : "";
	const type = typeof doc.type === "string" ? doc.type : "";
	const parts = [type, status].filter(Boolean);
	return parts.join(" • ");
};

const CustomizePanel: React.FC<CustomizePanelProps> = ({ onClose }) => {
	const [activeTab, setActiveTab] = useState<TabKey>("knowledge");

	const [supermemoryAvailable, setSupermemoryAvailable] = useState(true);
	const [containerTag, setContainerTag] = useState<string | null>(null);
	const [saveStatus, setSaveStatus] = useState<{
		type: "success" | "error" | null;
		message: string;
	}>({ type: null, message: "" });

	const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
	const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
	const PERSONALIZATION_DISABLED_MESSAGE =
		"Personalization is disabled. Add SUPERMEMORY_API_KEY in .env and restart.";

	// Personalization state
	const [selectedRole, setSelectedRole] = useState("default");
	const [customRoleText, setCustomRoleText] = useState("");
	const [textContext, setTextContext] = useState("");
	const [userFacts, setUserFacts] = useState("");

	const [aboutYouEntries, setAboutYouEntries] = useState<AboutYouEntry[]>([]);
	const [isAddingEntry, setIsAddingEntry] = useState(false);
	const [newEntryTitle, setNewEntryTitle] = useState("");
	const [newEntryContent, setNewEntryContent] = useState("");
	const [editingEntry, setEditingEntry] = useState<AboutYouEntry | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [editContent, setEditContent] = useState("");

	// Knowledge base state
	const [kbOverview, setKbOverview] = useState<KnowledgeBaseOverview | null>(null);
	const [kbLoading, setKbLoading] = useState(false);
	const [kbUrl, setKbUrl] = useState("");
	const [kbUrlTitle, setKbUrlTitle] = useState("");
	const [kbNoteTitle, setKbNoteTitle] = useState("");
	const [kbNoteContent, setKbNoteContent] = useState("");
	const [kbDocQuery, setKbDocQuery] = useState("");

	// Integrations state
	const [connections, setConnections] = useState<SupermemoryConnection[]>([]);
	const [connectionsLoading, setConnectionsLoading] = useState(false);
	const [providerDocs, setProviderDocs] = useState<Record<string, ConnectionDocument[]>>(
		{},
	);

	// Profile state
	const [userProfile, setUserProfile] = useState<{
		static: string[];
		dynamic: string[];
	} | null>(null);
	const [profileLoading, setProfileLoading] = useState(false);

	// Reset confirmation
	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const [isResetting, setIsResetting] = useState(false);

	const showStatus = useCallback(
		(type: "success" | "error", message: string) => {
			setSaveStatus({ type, message });
			setTimeout(() => setSaveStatus({ type: null, message: "" }), 3000);
		},
		[],
	);

	const requireSupermemory = useCallback((): boolean => {
		if (supermemoryAvailable) return true;
		showStatus("error", PERSONALIZATION_DISABLED_MESSAGE);
		return false;
	}, [supermemoryAvailable, showStatus]);

	const refreshKnowledgeBase = useCallback(async () => {
		if (!requireSupermemory()) return;
		setKbLoading(true);
		try {
			const result = await window.electronAPI.getKnowledgeBaseOverview();
			if (result.success && result.data) {
				setKbOverview(result.data);
			} else {
				showStatus("error", result.error || "Failed to load knowledge base");
			}
		} catch (error) {
			showStatus("error", "Failed to load knowledge base");
		} finally {
			setKbLoading(false);
		}
	}, [requireSupermemory, showStatus]);

	const refreshConnections = useCallback(async () => {
		if (!requireSupermemory()) return;
		setConnectionsLoading(true);
		try {
			const result = await window.electronAPI.listConnections();
			if (result.success && result.data) {
				setConnections(result.data);
			} else {
				showStatus("error", result.error || "Failed to load integrations");
			}
		} catch {
			showStatus("error", "Failed to load integrations");
		} finally {
			setConnectionsLoading(false);
		}
	}, [requireSupermemory, showStatus]);

	const refreshProfile = useCallback(async () => {
		if (!requireSupermemory()) return;
		setProfileLoading(true);
		try {
			const profile = await window.electronAPI.getUserProfile();
			setUserProfile(profile);
		} catch {
			setUserProfile(null);
		} finally {
			setProfileLoading(false);
		}
	}, [requireSupermemory]);

	const uploadSummary = useMemo(() => {
		const active = uploadTasks.filter(
			(task) => task.phase !== "ready" && task.phase !== "failed",
		);
		const ready = uploadTasks.filter((task) => task.phase === "ready");
		const failed = uploadTasks.filter((task) => task.phase === "failed");
		const uploadingNow = uploadTasks.some(
			(task) => task.phase === "preparing" || task.phase === "uploading",
		);
		const processingIds = uploadTasks
			.filter(
				(task) =>
					task.phase === "processing" &&
					typeof task.supermemoryId === "string" &&
					task.supermemoryId.trim().length > 0,
			)
			.map((task) => task.supermemoryId as string)
			.sort();

		return {
			active,
			ready,
			failed,
			uploadingNow,
			processingKey: processingIds.join("|"),
		};
	}, [uploadTasks]);

	useEffect(() => {
		if (!supermemoryAvailable) return;
		if (!uploadSummary.processingKey) return;

		const ids = uploadSummary.processingKey.split("|").filter(Boolean);
		if (ids.length === 0) return;

		let cancelled = false;

		const pollOnce = async () => {
			try {
				const results = await Promise.all(
					ids.map((id) => window.electronAPI.getDocumentStatus(id)),
				);
				if (cancelled) return;

				const byId = new Map<string, { status: string; title?: string | null }>();
				for (const res of results) {
					if (!res?.success || !res.data) continue;
					byId.set(res.data.id, res.data);
				}

				let shouldRefresh = false;
				setUploadTasks((prev) =>
					prev.map((task) => {
						if (task.phase !== "processing") return task;
						if (!task.supermemoryId) return task;
						const next = byId.get(task.supermemoryId);
						if (!next) return task;

						const status = next.status;
						const nextPhase: UploadPhase =
							status === "done"
								? "ready"
								: status === "failed"
									? "failed"
									: "processing";
						if (nextPhase !== "processing") shouldRefresh = true;

						return {
							...task,
							status,
							phase: nextPhase,
							error:
								nextPhase === "failed" ? task.error || "Processing failed." : task.error,
							updatedAt: Date.now(),
						};
					}),
				);

				if (shouldRefresh) {
					void refreshKnowledgeBase();
				}
			} catch {
				// ignore polling failures; the user can manually refresh
			}
		};

		const interval = setInterval(() => {
			void pollOnce();
		}, 2500);

		void pollOnce();

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [refreshKnowledgeBase, supermemoryAvailable, uploadSummary.processingKey]);

	useEffect(() => {
		const loadConfig = async () => {
			try {
				const config = await window.electronAPI.getCustomizeConfig();
				if (config) {
					setSupermemoryAvailable(true);
					const tag = await window.electronAPI.getSupermemoryContainerTag();
					setContainerTag(tag);
					setSelectedRole(config.role || "default");
					setCustomRoleText(config.customRoleText || "");
					setTextContext(config.textContext || "");
					setUserFacts(config.userFacts?.join("\n") || "");
					const entries = await window.electronAPI.getAboutYouEntries();
					setAboutYouEntries(entries || []);
					await Promise.allSettled([
						refreshKnowledgeBase(),
						refreshConnections(),
						refreshProfile(),
					]);
				} else {
					setSupermemoryAvailable(false);
					setContainerTag(null);
					setAboutYouEntries([]);
				}
			} catch (error) {
				console.error("Error loading customize config:", error);
				setSupermemoryAvailable(false);
			}
		};

		void loadConfig();
	}, []);

	// Role change
	const handleRoleChange = async (role: string) => {
		if (!requireSupermemory()) return;
		const previousRole = selectedRole;
		setSelectedRole(role);
		if (role !== "custom") {
			try {
				const result = await window.electronAPI.setRole(role);
				if (result.success) {
					showStatus("success", "Role updated");
				} else {
					showStatus("error", result.error || "Failed to update role");
					setSelectedRole(previousRole);
				}
			} catch {
				showStatus("error", "Failed to update role");
				setSelectedRole(previousRole);
			}
		}
	};

	const handleCustomRoleSave = async () => {
		if (!customRoleText.trim()) {
			showStatus("error", "Please enter a custom role description");
			return;
		}
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.setRole("custom", customRoleText);
			if (result.success) showStatus("success", "Custom role saved");
			else showStatus("error", result.error || "Failed to save custom role");
		} catch {
			showStatus("error", "Failed to save custom role");
		}
	};

	const handleTextContextSave = async () => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.setTextContext(textContext);
			if (result.success) showStatus("success", "Context saved");
			else showStatus("error", result.error || "Failed to save context");
		} catch {
			showStatus("error", "Failed to save context");
		}
	};

	const handleUserFactsSave = async () => {
		if (!requireSupermemory()) return;
		try {
			const facts = userFacts
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean);
			const result = await window.electronAPI.setUserFacts(facts);
			if (result.success) showStatus("success", "Notes saved");
			else showStatus("error", result.error || "Failed to save notes");
		} catch {
			showStatus("error", "Failed to save notes");
		}
	};

	// Knowledge base: file upload
	const handleKnowledgeFileUpload = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		if (!requireSupermemory()) return;

		try {
			const createLocalId = (): string => {
				if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
					return crypto.randomUUID();
				}
				return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
			};

			let uploadedCount = 0;
			let failedCount = 0;

			for (const file of Array.from(files)) {
				const localId = createLocalId();
				const now = Date.now();

				const initialTask: UploadTask = {
					localId,
					name: file.name,
					size: file.size,
					mimeType: file.type || undefined,
					phase: "preparing",
					startedAt: now,
					updatedAt: now,
				};

				setUploadTasks((prev) => [initialTask, ...prev].slice(0, 20));

				if (file.size > MAX_UPLOAD_BYTES) {
					failedCount += 1;
					setUploadTasks((prev) =>
						prev.map((task) =>
							task.localId === localId
								? {
										...task,
										phase: "failed",
										error: "File too large (max 50MB).",
										updatedAt: Date.now(),
									}
								: task,
						),
					);
					continue;
				}

				try {
					const bytes = new Uint8Array(await file.arrayBuffer());
					setUploadTasks((prev) =>
						prev.map((task) =>
							task.localId === localId
								? { ...task, phase: "uploading", updatedAt: Date.now() }
								: task,
						),
					);

					const result = await window.electronAPI.uploadDocumentData({
						name: file.name,
						data: bytes,
						mimeType: file.type || undefined,
					});

					if (!result.success || !result.data) {
						throw new Error(result.error || "Upload failed");
					}

					uploadedCount += 1;
					const documentId = result.data.id;
					const normalizedStatus =
						result.data.status === "processing" ? "queued" : result.data.status;
					const nextPhase: UploadPhase =
						normalizedStatus === "done"
							? "ready"
							: normalizedStatus === "failed"
								? "failed"
								: "processing";
					setUploadTasks((prev) =>
						prev.map((task) =>
								task.localId === localId
									? {
											...task,
											phase: nextPhase,
											supermemoryId: documentId,
											status: normalizedStatus,
											updatedAt: Date.now(),
										}
									: task,
						),
					);
				} catch (error) {
					failedCount += 1;
					const message = error instanceof Error ? error.message : String(error);
					setUploadTasks((prev) =>
						prev.map((task) =>
							task.localId === localId
								? {
										...task,
										phase: "failed",
										error: message || "Upload failed",
										updatedAt: Date.now(),
									}
								: task,
						),
					);
				}
			}

			if (uploadedCount > 0) {
				showStatus(
					failedCount > 0 ? "error" : "success",
					failedCount > 0
						? `Uploaded ${uploadedCount}, failed ${failedCount}`
						: `Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}`,
				);
			} else if (failedCount > 0) {
				showStatus("error", "Upload failed");
			}
		} catch {
			showStatus("error", "Failed to upload file");
		} finally {
			await refreshKnowledgeBase();
		}
	};

	const handleDeleteDocument = async (docId: string) => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.deleteDocument(docId);
			if (result.success) {
				showStatus("success", "Removed");
				await refreshKnowledgeBase();
			} else {
				showStatus("error", result.error || "Failed to remove");
			}
		} catch {
			showStatus("error", "Failed to remove");
		}
	};

	const handleAddUrl = async () => {
		if (!kbUrl.trim()) {
			showStatus("error", "Enter a URL");
			return;
		}
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.addKnowledgeUrl({
				url: kbUrl.trim(),
				title: kbUrlTitle.trim() || undefined,
			});
			if (result.success) {
				setKbUrl("");
				setKbUrlTitle("");
				showStatus("success", "Link added");
				await refreshKnowledgeBase();
			} else {
				showStatus("error", result.error || "Failed to add link");
			}
		} catch {
			showStatus("error", "Failed to add link");
		}
	};

	const handleAddNote = async () => {
		if (!kbNoteTitle.trim()) {
			showStatus("error", "Enter a title");
			return;
		}
		if (!kbNoteContent.trim()) {
			showStatus("error", "Enter note content");
			return;
		}
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.addKnowledgeText({
				title: kbNoteTitle.trim(),
				content: kbNoteContent.trim(),
			});
			if (result.success) {
				setKbNoteTitle("");
				setKbNoteContent("");
				showStatus("success", "Note saved");
				await refreshKnowledgeBase();
			} else {
				showStatus("error", result.error || "Failed to save note");
			}
		} catch {
			showStatus("error", "Failed to save note");
		}
	};

	// About You (text entries only)
	const handleAddTextEntry = async () => {
		if (!newEntryTitle.trim()) {
			showStatus("error", "Please enter a title");
			return;
		}
		if (!newEntryContent.trim()) {
			showStatus("error", "Please enter content");
			return;
		}
		if (!requireSupermemory()) return;

		try {
			const result = await window.electronAPI.addAboutYouTextEntry(
				newEntryTitle.trim(),
				newEntryContent.trim(),
			);
			if (result.success && result.data) {
				setAboutYouEntries((entries) => [...entries, result.data!]);
				setNewEntryTitle("");
				setNewEntryContent("");
				setIsAddingEntry(false);
				showStatus("success", "Entry added");
			} else {
				showStatus("error", result.error || "Failed to add entry");
			}
		} catch {
			showStatus("error", "Failed to add entry");
		}
	};

	const handleStartEdit = (entry: AboutYouEntry) => {
		setEditingEntry(entry);
		setEditTitle(entry.title);
		setEditContent(entry.content);
	};

	const handleSaveEdit = async () => {
		if (!editingEntry) return;
		if (!editTitle.trim()) {
			showStatus("error", "Please enter a title");
			return;
		}
		if (!editContent.trim()) {
			showStatus("error", "Please enter content");
			return;
		}

		try {
			const result = await window.electronAPI.updateAboutYouEntry(
				editingEntry.id,
				editTitle.trim(),
				editContent.trim(),
			);
			if (result.success && result.data) {
				setAboutYouEntries((entries) =>
					entries.map((e) => (e.id === editingEntry.id ? result.data! : e)),
				);
				setEditingEntry(null);
				showStatus("success", "Entry updated");
			} else {
				showStatus("error", result.error || "Failed to update entry");
			}
		} catch {
			showStatus("error", "Failed to update entry");
		}
	};

	const handleDeleteEntry = async (id: string) => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.deleteAboutYouEntry(id);
			if (result.success) {
				setAboutYouEntries((entries) => entries.filter((e) => e.id !== id));
				showStatus("success", "Entry removed");
			} else {
				showStatus("error", result.error || "Failed to remove entry");
			}
		} catch {
			showStatus("error", "Failed to remove entry");
		}
	};

	// Integrations
	const providerById = useMemo(() => {
		return new Map(PROVIDERS.map((p) => [p.id, p] as const));
	}, []);

	const connectionByProvider = useMemo(() => {
		const map = new Map<SupermemoryProvider, SupermemoryConnection>();
		for (const conn of connections) {
			const provider = conn.provider as SupermemoryProvider;
			if (providerById.has(provider)) map.set(provider, conn);
		}
		return map;
	}, [connections, providerById]);

	const handleConnect = async (provider: SupermemoryProvider) => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.createConnection({ provider });
			if (result.success && result.data) {
				const opened = await window.electronAPI.openExternalUrl(result.data.authLink);
				if (!opened.success) {
					showStatus("error", opened.error || "Failed to open authorization link");
				} else {
					showStatus("success", "Finish authorization in your browser");
				}
				await refreshConnections();
			} else {
				showStatus("error", result.error || "Failed to start connection");
			}
		} catch {
			showStatus("error", "Failed to start connection");
		}
	};

	const handleSync = async (provider: SupermemoryProvider) => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.syncConnection(provider);
			if (result.success) showStatus("success", result.data?.message || "Sync started");
			else showStatus("error", result.error || "Failed to start sync");
		} catch {
			showStatus("error", "Failed to start sync");
		}
	};

	const handleDisconnect = async (provider: SupermemoryProvider) => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.deleteConnection(provider);
			if (result.success) {
				showStatus("success", "Disconnected");
				await refreshConnections();
			} else {
				showStatus("error", result.error || "Failed to disconnect");
			}
		} catch {
			showStatus("error", "Failed to disconnect");
		}
	};

	const handleLoadProviderDocs = async (provider: SupermemoryProvider) => {
		if (!requireSupermemory()) return;
		try {
			const result = await window.electronAPI.listConnectionDocuments(provider);
			if (result.success && result.data) {
				setProviderDocs((prev) => ({ ...prev, [provider]: result.data! }));
			} else {
				showStatus("error", result.error || "Failed to load documents");
			}
		} catch {
			showStatus("error", "Failed to load documents");
		}
	};

	const handleFullReset = async () => {
		setIsResetting(true);
		try {
			const result = await window.electronAPI.fullResetCustomization();
			if (result.success) {
				setSelectedRole("default");
				setCustomRoleText("");
				setTextContext("");
				setUserFacts("");
				setAboutYouEntries([]);
				setKbOverview(null);
				setConnections([]);
				setProviderDocs({});
				setUserProfile(null);
				setShowResetConfirm(false);
				showStatus("success", "All settings reset");
			} else {
				showStatus("error", result.error || "Failed to reset");
			}
		} catch {
			showStatus("error", "Failed to reset");
		} finally {
			setIsResetting(false);
		}
	};

	const formatUploadLabel = (task: UploadTask): string => {
		if (task.phase === "preparing") return "Reading file (local)";
		if (task.phase === "uploading") return "Uploading from app to Supermemory";
		if (task.phase === "processing") {
			return `Processing${task.status ? `: ${task.status}` : ""}`;
		}
		if (task.phase === "ready") return "Ready";
		return task.error ? `Failed: ${task.error}` : "Failed";
	};

	const clearFinishedUploads = () => {
		setUploadTasks((prev) =>
			prev.filter((task) => task.phase !== "ready" && task.phase !== "failed"),
		);
	};

	const kbReadyDocs = kbOverview?.ready ?? [];
	const kbProcessing = kbOverview?.processing ?? [];
	const filteredReadyDocs = useMemo(() => {
		const q = kbDocQuery.trim().toLowerCase();
		if (!q) return kbReadyDocs;
		return kbReadyDocs.filter((doc) => {
			const title = formatDocTitle(doc).toLowerCase();
			const subtitle = formatDocSubtitle(doc).toLowerCase();
			if (title.includes(q) || subtitle.includes(q) || doc.id.toLowerCase().includes(q)) {
				return true;
			}
			const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
			const filename = typeof metadata.filename === "string" ? metadata.filename.toLowerCase() : "";
			return filename.includes(q);
		});
	}, [kbDocQuery, kbReadyDocs]);

		return (
			<div className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 w-full min-w-[300px] max-w-[460px]">
				<div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
					<div className="flex items-center gap-2">
						<img
							src="/logos/icon.png"
							alt="Clueless"
							className="h-5 w-auto opacity-90 select-none"
							draggable={false}
						/>
						<h3 className="text-sm font-medium text-white/90">Customize</h3>
					</div>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => {
							if (activeTab === "knowledge") refreshKnowledgeBase();
							if (activeTab === "integrations") refreshConnections();
							if (activeTab === "personal") refreshProfile();
						}}
						disabled={!supermemoryAvailable}
						className="text-white/50 hover:text-white/80 transition-colors disabled:opacity-50"
						title="Refresh"
					>
						<IoRefresh className={`w-4 h-4 ${kbLoading || connectionsLoading || profileLoading ? "animate-spin" : ""}`} />
					</button>
					{onClose && (
						<button
							type="button"
							onClick={onClose}
							className="text-white/50 hover:text-white/80 transition-colors"
						>
							<IoClose className="w-4 h-4" />
						</button>
					)}
				</div>
			</div>

			{saveStatus.type && (
				<div
					className={`text-xs px-3 py-2 rounded-lg mb-3 ${
						saveStatus.type === "success"
							? "bg-green-500/20 text-green-300"
							: "bg-red-500/20 text-red-300"
					}`}
				>
					{saveStatus.message}
				</div>
			)}

			{!supermemoryAvailable && (
				<div className="text-xs px-3 py-2 rounded-lg mb-3 bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
					Add `SUPERMEMORY_API_KEY` to your `.env` and restart to enable
					personalization, knowledge base, and integrations.
				</div>
			)}

			{uploadTasks.length > 0 && (
				<div className="px-3 py-2 rounded-lg mb-3 bg-white/5 border border-white/10">
					<div className="flex items-center justify-between mb-2">
						<p className="text-[11px] text-white/80 font-medium">Uploads</p>
						<button
							type="button"
							onClick={clearFinishedUploads}
							disabled={uploadSummary.ready.length + uploadSummary.failed.length === 0}
							className="text-[10px] text-white/40 hover:text-white/70 disabled:opacity-50"
						>
							Clear finished
						</button>
					</div>
					<div className="space-y-1">
						{uploadTasks.slice(0, 6).map((task) => (
							<div
								key={task.localId}
								className="flex items-start justify-between gap-2 bg-black/20 rounded-md px-2 py-2"
							>
								<div className="min-w-0 flex-1">
									<span className="text-[11px] font-medium text-white/80 block truncate">
										{task.name}
									</span>
									<p className="text-[9px] text-white/40 line-clamp-2">
										{formatUploadLabel(task)}
									</p>
								</div>
								<span
									className={`text-[10px] flex-shrink-0 ${
										task.phase === "ready"
											? "text-green-300/80"
											: task.phase === "failed"
												? "text-red-300/80"
												: "text-yellow-300/80"
									}`}
								>
									{task.phase === "ready"
										? "Ready"
										: task.phase === "failed"
											? "Failed"
											: task.phase === "uploading"
												? "Uploading"
												: task.phase === "preparing"
													? "Preparing"
													: task.status || "Processing"}
								</span>
							</div>
						))}
					</div>
					{(uploadSummary.ready.length > 0 || uploadSummary.failed.length > 0) && (
						<p className="text-[10px] text-white/40 mt-2">
							This session: {uploadSummary.ready.length} ready •{" "}
							{uploadSummary.failed.length} failed
						</p>
					)}
				</div>
			)}

			<div className="flex bg-white/5 rounded-lg p-1 mb-3">
				{[
					{ id: "knowledge", label: "Knowledge", icon: <IoDocumentText className="w-3 h-3" /> },
					{ id: "integrations", label: "Integrations", icon: <IoSettings className="w-3 h-3" /> },
					{ id: "personal", label: "Personal", icon: <IoPersonCircle className="w-3 h-3" /> },
				].map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setActiveTab(tab.id as TabKey)}
						className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[10px] transition-colors ${
							activeTab === tab.id
								? "bg-white/15 text-white/90"
								: "text-white/50 hover:text-white/80 hover:bg-white/10"
						}`}
					>
						{tab.icon}
						{tab.label}
					</button>
				))}
			</div>

			{showResetConfirm && (
				<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
					<div className="flex items-start gap-2">
						<IoWarning className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
						<div className="flex-1">
							<p className="text-xs text-white/90 font-medium">Reset All?</p>
							<p className="text-[10px] text-white/60 mt-1">
								This deletes local personalization and clears saved data.
							</p>
						</div>
					</div>
					<div className="flex justify-end gap-2 mt-2">
						<button
							type="button"
							onClick={() => setShowResetConfirm(false)}
							className="px-2 py-1 text-[10px] text-white/70 hover:text-white/90"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleFullReset}
							disabled={isResetting}
							className="px-2 py-1 bg-red-500/30 hover:bg-red-500/40 text-red-300 text-[10px] rounded-md disabled:opacity-50"
						>
							{isResetting ? "..." : "Reset"}
						</button>
					</div>
				</div>
			)}

			<div className="max-h-[60vh] overflow-y-auto overflow-x-hidden pr-1 space-y-1">
				{activeTab === "knowledge" && (
					<>
						<Section
							title="Workspace Scope"
							icon={<IoCreate className="w-4 h-4" />}
						>
							<p className="text-[10px] text-white/40 mb-2">
								This tag isolates your files, notes, call transcripts, and profile so projects don’t mix.
								To change it, set <span className="text-white/70">SUPERMEMORY_CONTAINER_TAG</span> in
								<code className="mx-1 px-1 py-0.5 bg-white/10 rounded text-white/70">.env</code>
								and restart.
							</p>
							<div className="flex items-center justify-between gap-2 bg-white/5 rounded-md px-2 py-2">
								<span className="text-[10px] text-white/70 truncate">
									{containerTag || "Unavailable"}
								</span>
								<button
									type="button"
									onClick={() => {
										if (!containerTag) return;
										navigator.clipboard
											.writeText(containerTag)
											.then(() => showStatus("success", "Copied workspace tag"))
											.catch(() => showStatus("error", "Could not copy"));
									}}
									disabled={!containerTag}
									className="text-[10px] text-white/50 hover:text-white/80 disabled:opacity-50"
								>
									Copy
								</button>
							</div>
						</Section>

						<Section
							title="Add Files"
							icon={<IoCloudUpload className="w-4 h-4" />}
							defaultOpen={true}
							>
								<p className="text-[10px] text-white/40 mb-2">
									Upload PDFs, docs, images, or CSVs. Once processed, you can ask questions and get answers grounded in your files.
								</p>
							<FileDropZone
								accept=".pdf,.txt,.md,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.csv,.mp4,.webm"
								multiple
								disabled={uploadSummary.uploadingNow || !supermemoryAvailable}
								helperText={uploadSummary.uploadingNow ? "Uploading..." : "Drag & drop or"}
								onFilesSelected={handleKnowledgeFileUpload}
							/>
							<button
								type="button"
								onClick={refreshKnowledgeBase}
								disabled={!supermemoryAvailable}
								className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
							>
								Refresh status
							</button>
						</Section>

								<Section title="Add Link" icon={<IoLink className="w-4 h-4" />}>
									<p className="text-[10px] text-white/40 mb-2">
										Save a URL reference (bookmark). Re-adding the same URL updates instead of duplicating. For searchable content, upload a file or paste key excerpts into a note.
									</p>
							<input
								value={kbUrlTitle}
								onChange={(e) => setKbUrlTitle(e.target.value)}
								disabled={!supermemoryAvailable}
								placeholder="Optional label (e.g., API docs)"
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 placeholder-white/40"
							/>
							<input
								value={kbUrl}
								onChange={(e) => setKbUrl(e.target.value)}
								disabled={!supermemoryAvailable}
								placeholder="https://..."
								className="mt-2 w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 placeholder-white/40"
							/>
							<div className="flex justify-end mt-2">
								<button
									type="button"
									onClick={handleAddUrl}
									disabled={!supermemoryAvailable}
									className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
								>
									Add link
								</button>
							</div>
						</Section>

							<Section title="Add Note" icon={<IoDocumentText className="w-4 h-4" />}>
								<p className="text-[10px] text-white/40 mb-2">
									Short, high-signal notes (playbooks, policies, meeting context). Use a stable title to update instead of duplicating.
								</p>
							<input
								value={kbNoteTitle}
								onChange={(e) => setKbNoteTitle(e.target.value)}
								disabled={!supermemoryAvailable}
								placeholder="Title (unique)"
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 placeholder-white/40"
							/>
							<textarea
								value={kbNoteContent}
								onChange={(e) => setKbNoteContent(e.target.value)}
								disabled={!supermemoryAvailable}
								placeholder="Write the note..."
								className="mt-2 w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[80px] resize-none placeholder-white/40"
							/>
							<div className="flex justify-end mt-2">
								<button
									type="button"
									onClick={handleAddNote}
									disabled={!supermemoryAvailable}
									className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
								>
									Save note
								</button>
							</div>
						</Section>

						<Section
							title="Ready To Use"
							icon={<IoDocumentText className="w-4 h-4" />}
							defaultOpen={true}
							badge={kbReadyDocs.length}
						>
								<div className="flex items-center justify-between mb-2">
									<p className="text-[10px] text-white/40">
										Processed documents that are ready for grounded answers.
									</p>
								<button
									type="button"
									onClick={refreshKnowledgeBase}
									disabled={!supermemoryAvailable}
									className="text-[10px] text-white/50 hover:text-white/80 disabled:opacity-50"
								>
									Refresh
								</button>
							</div>
							<div className="mb-2">
								<input
									value={kbDocQuery}
									onChange={(e) => setKbDocQuery(e.target.value)}
									disabled={!supermemoryAvailable}
									placeholder="Filter documents..."
									className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 placeholder-white/40 disabled:opacity-50"
								/>
								{kbDocQuery.trim() && (
									<p className="text-[10px] text-white/40 mt-1">
										Showing {Math.min(30, filteredReadyDocs.length)} of {filteredReadyDocs.length} matches
									</p>
								)}
							</div>
							{kbReadyDocs.length === 0 ? (
								<p className="text-[10px] text-white/40">
									No ready documents yet.
								</p>
							) : filteredReadyDocs.length === 0 ? (
								<p className="text-[10px] text-white/40">
									No matches. Try a different keyword.
								</p>
							) : (
								<div className="space-y-1">
									{filteredReadyDocs.slice(0, 30).map((doc) => (
										<div
											key={doc.id}
											className="flex items-start justify-between gap-2 bg-white/5 rounded-md px-2 py-2"
										>
											<div className="min-w-0 flex-1">
												<span className="text-[11px] font-medium text-white/80 block truncate">
													{formatDocTitle(doc)}
												</span>
												<p className="text-[9px] text-white/40 truncate">
													{formatDocSubtitle(doc)}
												</p>
												{typeof doc.summary === "string" && doc.summary.trim() && (
													<p className="text-[9px] text-white/50 mt-1 line-clamp-2">
														{doc.summary}
													</p>
												)}
											</div>
											<button
												type="button"
												onClick={() => handleDeleteDocument(doc.id)}
												className="text-red-400/70 hover:text-red-400 flex-shrink-0"
												title="Remove"
											>
												<IoTrash className="w-3 h-3" />
											</button>
										</div>
									))}
									{filteredReadyDocs.length > 30 && (
										<p className="text-[10px] text-white/40">
											Showing 30 of {filteredReadyDocs.length}.
										</p>
									)}
								</div>
							)}
						</Section>

						<Section
							title="Processing"
							icon={<IoSync className="w-4 h-4" />}
							badge={kbProcessing.length}
						>
								<p className="text-[10px] text-white/40 mb-2">
									Uploads and integrations may take a minute to become searchable. If something isn’t found yet, try again once processing finishes.
								</p>
							{kbProcessing.length === 0 ? (
								<p className="text-[10px] text-white/40">Nothing processing.</p>
							) : (
								<div className="space-y-1">
									{kbProcessing.slice(0, 20).map((doc) => (
										<div
											key={doc.id}
											className="flex items-center justify-between bg-white/5 rounded-md px-2 py-1.5"
										>
											<span className="text-[10px] text-white/70 truncate">
												{doc.title || doc.id}
											</span>
											<span className="text-[10px] text-white/40">
												{doc.status}
											</span>
										</div>
									))}
								</div>
							)}
						</Section>
					</>
				)}

				{activeTab === "integrations" && (
					<>
						<Section
							title="Connected Integrations"
							icon={<IoSettings className="w-4 h-4" />}
							defaultOpen={true}
							badge={connections.length}
						>
								<div className="flex items-center justify-between mb-2">
									<p className="text-[10px] text-white/40">
										Connect sources, then sync to index content into your knowledge base.
									</p>
								<button
									type="button"
									onClick={refreshConnections}
									disabled={!supermemoryAvailable}
									className="text-[10px] text-white/50 hover:text-white/80 disabled:opacity-50"
								>
									Refresh
								</button>
							</div>

							<div className="space-y-2">
								{PROVIDERS.map((p) => {
									const conn = connectionByProvider.get(p.id);
									return (
										<div key={p.id} className="bg-white/5 rounded-lg p-3">
											<div className="flex items-start justify-between gap-2">
												<div className="min-w-0 flex-1">
													<p className="text-xs text-white/90 font-medium">
														{p.label}
													</p>
													<p className="text-[10px] text-white/40 mt-0.5">
														{p.description}
													</p>
													{conn?.email && (
														<p className="text-[10px] text-white/50 mt-1 truncate">
															{conn.email}
														</p>
													)}
													{conn && (
														<p className="text-[10px] text-white/40 mt-1">
															Connected • {conn.id}
														</p>
													)}
												</div>
												<div className="flex items-center gap-1 flex-shrink-0">
													{conn ? (
														<>
															<button
																type="button"
																onClick={() => handleSync(p.id)}
																disabled={!supermemoryAvailable}
																className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
															>
																Sync
															</button>
															<button
																type="button"
																onClick={() => handleDisconnect(p.id)}
																disabled={!supermemoryAvailable}
																className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 text-[10px] rounded-md disabled:opacity-50"
															>
																Disconnect
															</button>
														</>
													) : (
														<button
															type="button"
															onClick={() => handleConnect(p.id)}
															disabled={!supermemoryAvailable}
															className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
														>
															Connect
														</button>
													)}
												</div>
											</div>

											{conn && (
												<div className="flex items-center gap-2 mt-2">
													<button
														type="button"
														onClick={() => handleLoadProviderDocs(p.id)}
														disabled={!supermemoryAvailable}
														className="text-[10px] text-white/50 hover:text-white/80 disabled:opacity-50"
													>
														Show documents
													</button>
												</div>
											)}

											{Array.isArray(providerDocs[p.id]) &&
												providerDocs[p.id].length > 0 && (
													<div className="mt-2 space-y-1">
														{providerDocs[p.id].slice(0, 8).map((d) => (
															<div
																key={d.id}
																className="flex items-center justify-between bg-black/20 rounded-md px-2 py-1.5"
															>
																<span className="text-[10px] text-white/70 truncate">
																	{d.title || d.id}
																</span>
																<span className="text-[10px] text-white/40">
																	{d.status}
																</span>
															</div>
														))}
														{providerDocs[p.id].length > 8 && (
															<p className="text-[10px] text-white/40">
																Showing 8 of {providerDocs[p.id].length}.
															</p>
														)}
													</div>
												)}
										</div>
									);
								})}
							</div>

							{connectionsLoading && (
								<p className="text-[10px] text-white/40 mt-2">Loading…</p>
							)}
						</Section>
					</>
				)}

				{activeTab === "personal" && (
					<>
						<Section
							title="About You"
							icon={<IoPersonCircle className="w-4 h-4" />}
							defaultOpen={true}
							badge={aboutYouEntries.length}
						>
							<p className="text-[10px] text-white/40 mb-2">
								Persistent personal facts and preferences. Keep it short and high-signal.
							</p>

							{!isAddingEntry && (
								<button
									type="button"
									onClick={() => setIsAddingEntry(true)}
									disabled={!supermemoryAvailable}
									className="w-full flex items-center justify-center gap-1 py-2 text-xs text-white/60 hover:text-white/80 hover:bg-white/5 rounded-lg transition-colors border border-dashed border-white/20 disabled:opacity-50"
								>
									<IoAdd className="w-3 h-3" />
									Add entry
								</button>
							)}

							{isAddingEntry && (
								<div className="bg-white/5 rounded-lg p-3 space-y-2">
									<input
										type="text"
										value={newEntryTitle}
										onChange={(e) => setNewEntryTitle(e.target.value)}
										placeholder="Title (e.g., Work style)"
										className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 placeholder-white/40"
									/>
									<textarea
										value={newEntryContent}
										onChange={(e) => setNewEntryContent(e.target.value)}
										placeholder="Write a few lines..."
										className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[70px] resize-none placeholder-white/40"
									/>
									<div className="flex justify-end gap-2">
										<button
											type="button"
											onClick={() => {
												setIsAddingEntry(false);
												setNewEntryTitle("");
												setNewEntryContent("");
											}}
											className="px-2 py-1 text-[10px] text-white/50 hover:text-white/70"
										>
											Cancel
										</button>
										<button
											type="button"
											onClick={handleAddTextEntry}
											disabled={!supermemoryAvailable}
											className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
										>
											Save
										</button>
									</div>
								</div>
							)}

							{aboutYouEntries.length > 0 && (
								<div className="space-y-2 mt-2">
									{aboutYouEntries.map((entry) => (
										<div key={entry.id} className="bg-white/5 rounded-md p-2">
											{editingEntry?.id === entry.id ? (
												<div className="space-y-2">
													<input
														type="text"
														value={editTitle}
														onChange={(e) => setEditTitle(e.target.value)}
														className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1 border border-white/20 focus:outline-none"
													/>
													<textarea
														value={editContent}
														onChange={(e) => setEditContent(e.target.value)}
														className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1 border border-white/20 focus:outline-none min-h-[50px] resize-none"
													/>
													<div className="flex justify-end gap-2">
														<button
															type="button"
															onClick={() => setEditingEntry(null)}
															className="px-2 py-1 text-[10px] text-white/50"
														>
															Cancel
														</button>
														<button
															type="button"
															onClick={handleSaveEdit}
															className="px-2 py-1 bg-white/10 text-white/90 text-[10px] rounded-md"
														>
															Save
														</button>
													</div>
												</div>
											) : (
												<div className="flex items-start justify-between gap-2">
													<div className="min-w-0 flex-1">
														<span className="text-[11px] font-medium text-white/80 block truncate">
															{entry.title}
														</span>
														<p className="text-[9px] text-white/40 mt-0.5 line-clamp-2">
															{entry.content}
														</p>
													</div>
													<div className="flex items-center gap-1 flex-shrink-0">
														{entry.type === "text" && (
															<button
																type="button"
																onClick={() => handleStartEdit(entry)}
																className="text-white/40 hover:text-white/70 p-0.5"
																title="Edit"
															>
																<IoCreate className="w-3 h-3" />
															</button>
														)}
														<button
															type="button"
															onClick={() => handleDeleteEntry(entry.id)}
															className="text-red-400/70 hover:text-red-400 p-0.5"
															title="Remove"
														>
															<IoTrash className="w-3 h-3" />
														</button>
													</div>
												</div>
											)}
										</div>
									))}
								</div>
							)}
						</Section>

						<Section title="Assistant Role" icon={<IoPersonCircle className="w-4 h-4" />}>
							<select
								value={selectedRole}
								onChange={(e) => handleRoleChange(e.target.value)}
								disabled={!supermemoryAvailable}
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40"
							>
								{Object.entries(ROLE_LABELS).map(([key, label]) => (
									<option key={key} value={key} className="bg-gray-800 text-white">
										{label}
									</option>
								))}
							</select>

							{selectedRole === "custom" && (
								<div className="mt-2 space-y-2">
									<textarea
										value={customRoleText}
										onChange={(e) => setCustomRoleText(e.target.value)}
										disabled={!supermemoryAvailable}
										placeholder="Describe the role..."
										className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[80px] resize-none placeholder-white/40"
									/>
									<button
										type="button"
										onClick={handleCustomRoleSave}
										disabled={!supermemoryAvailable}
										className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
									>
										Apply
									</button>
								</div>
							)}
						</Section>

						<Section title="Session Context" icon={<IoDocumentText className="w-4 h-4" />}>
							<p className="text-[10px] text-white/40 mb-2">
								Temporary context for the current session.
							</p>
							<textarea
								value={textContext}
								onChange={(e) => setTextContext(e.target.value)}
								disabled={!supermemoryAvailable}
								placeholder="Meeting notes, background info..."
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[80px] resize-none placeholder-white/40"
							/>
							<button
								type="button"
								onClick={handleTextContextSave}
								disabled={!supermemoryAvailable}
								className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
							>
								Save
							</button>
						</Section>

						<Section title="Quick Notes" icon={<IoDocumentText className="w-4 h-4" />}>
							<p className="text-[10px] text-white/40 mb-2">
								Preferences or facts (one per line).
							</p>
							<textarea
								value={userFacts}
								onChange={(e) => setUserFacts(e.target.value)}
								disabled={!supermemoryAvailable}
								placeholder="- Keep answers concise\n- Ask clarifying questions"
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[80px] resize-none placeholder-white/40"
							/>
							<button
								type="button"
								onClick={handleUserFactsSave}
								disabled={!supermemoryAvailable}
								className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
							>
								Save
							</button>
						</Section>

						<Section title="Profile" icon={<IoPersonCircle className="w-4 h-4" />}>
							<p className="text-[10px] text-white/40 mb-2">
								Auto-generated preferences (static + dynamic). Refresh to update.
							</p>
							<button
								type="button"
								onClick={refreshProfile}
								disabled={!supermemoryAvailable}
								className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md disabled:opacity-50"
							>
								Refresh profile
							</button>
							{userProfile ? (
								<div className="mt-2 space-y-2">
									{userProfile.static?.length > 0 && (
										<div className="bg-black/20 rounded-md p-2">
											<p className="text-[10px] text-white/60 mb-1">Static</p>
											<ul className="text-[10px] text-white/70 list-disc pl-4 space-y-0.5">
												{userProfile.static.slice(0, 8).map((s) => (
													<li key={s}>{s}</li>
												))}
											</ul>
										</div>
									)}
									{userProfile.dynamic?.length > 0 && (
										<div className="bg-black/20 rounded-md p-2">
											<p className="text-[10px] text-white/60 mb-1">Dynamic</p>
											<ul className="text-[10px] text-white/70 list-disc pl-4 space-y-0.5">
												{userProfile.dynamic.slice(0, 8).map((s) => (
													<li key={s}>{s}</li>
												))}
											</ul>
										</div>
									)}
									{(userProfile.static?.length ?? 0) === 0 &&
										(userProfile.dynamic?.length ?? 0) === 0 && (
											<p className="text-[10px] text-white/40">
												No profile items yet.
											</p>
										)}
								</div>
							) : (
								<p className="text-[10px] text-white/40 mt-2">
									No profile loaded.
								</p>
							)}
						</Section>
					</>
				)}
			</div>

			<div className="mt-3 pt-3 border-t border-white/10">
				<button
					type="button"
					onClick={() => setShowResetConfirm(true)}
					className="flex items-center gap-1 text-red-400/70 hover:text-red-400 transition-colors text-[10px]"
				>
					<IoRefresh className="w-3 h-3" />
					Reset All Settings
				</button>
			</div>
		</div>
	);
};

export default CustomizePanel;
