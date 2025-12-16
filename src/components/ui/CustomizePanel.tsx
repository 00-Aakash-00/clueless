import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	IoChevronDown,
	IoChevronForward,
	IoClose,
	IoCloudUpload,
	IoCreate,
	IoDocument,
	IoDocumentText,
	IoPersonCircle,
	IoRefresh,
	IoTrash,
	IoWarning,
	IoAdd,
} from "react-icons/io5";

interface StoredDocument {
	id: string;
	name: string;
	type: string;
	addedAt: number;
}

interface AboutYouEntry {
	id: string;
	title: string;
	content: string;
	type: "text" | "file";
	filePath?: string;
	fileName?: string;
	supermemoryId?: string;
	addedAt: number;
}

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

// Collapsible Section Component
interface SectionProps {
	title: string;
	icon: React.ReactNode;
	children: React.ReactNode;
	defaultOpen?: boolean;
	badge?: number;
}

const Section: React.FC<SectionProps> = ({
	title,
	icon,
	children,
	defaultOpen = false,
	badge,
}) => {
	const [isOpen, setIsOpen] = useState(defaultOpen);

	return (
		<div className="border-b border-white/10 last:border-b-0">
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				className="w-full flex items-center justify-between py-3 px-1 text-left hover:bg-white/5 transition-colors rounded-lg"
			>
				<div className="flex items-center gap-2">
					<span className="text-white/60">{icon}</span>
					<span className="text-xs font-medium text-white/80">{title}</span>
					{badge !== undefined && badge > 0 && (
						<span className="text-[10px] bg-white/20 text-white/70 px-1.5 py-0.5 rounded-full">
							{badge}
						</span>
					)}
				</div>
				{isOpen ? (
					<IoChevronDown className="w-4 h-4 text-white/50" />
				) : (
					<IoChevronForward className="w-4 h-4 text-white/50" />
				)}
			</button>
			{isOpen && <div className="pb-3 px-1">{children}</div>}
		</div>
	);
};

interface FileDropZoneProps {
	accept: string;
	multiple?: boolean;
	disabled?: boolean;
	helperText: string;
	buttonLabel?: string;
	onFilesSelected: (files: FileList | null) => void;
}

const FileDropZone: React.FC<FileDropZoneProps> = ({
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
		// Allow selecting the same file again.
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

const CustomizePanel: React.FC<CustomizePanelProps> = ({ onClose }) => {
	// State for role selection
	const [selectedRole, setSelectedRole] = useState("default");
	const [customRoleText, setCustomRoleText] = useState("");

	// State for text context
	const [textContext, setTextContext] = useState("");

	// State for documents
	const [documents, setDocuments] = useState<StoredDocument[]>([]);
	const [isUploading, setIsUploading] = useState(false);

	// State for user facts
	const [userFacts, setUserFacts] = useState("");

	// State for About You
	const [aboutYouEntries, setAboutYouEntries] = useState<AboutYouEntry[]>([]);
	const [isAddingEntry, setIsAddingEntry] = useState(false);
	const [addEntryType, setAddEntryType] = useState<"text" | "file">("text");
	const [newEntryTitle, setNewEntryTitle] = useState("");
	const [newEntryContent, setNewEntryContent] = useState("");
	const [editingEntry, setEditingEntry] = useState<AboutYouEntry | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [editContent, setEditContent] = useState("");
	const [isAboutYouUploading, setIsAboutYouUploading] = useState(false);

	// State for reset confirmation
	const [showResetConfirm, setShowResetConfirm] = useState(false);
	const [isResetting, setIsResetting] = useState(false);

	// Personalization availability (requires Supermemory API key)
	const [personalizationAvailable, setPersonalizationAvailable] = useState(true);

	// State for feedback
	const [saveStatus, setSaveStatus] = useState<{
		type: "success" | "error" | null;
		message: string;
	}>({ type: null, message: "" });

	// State for upload tracking (session-wide)
	const [uploadStats, setUploadStats] = useState<{
		uploadedThisSession: number;
		currentUploadName: string;
	}>({
		uploadedThisSession: 0,
		currentUploadName: "",
	});
	const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB
	const PERSONALIZATION_DISABLED_MESSAGE =
		"Personalization is disabled. Add SUPERMEMORY_API_KEY in .env and restart.";

	// Load initial config
	useEffect(() => {
		const loadConfig = async () => {
			try {
				const config = await window.electronAPI.getCustomizeConfig();
				if (config) {
					setPersonalizationAvailable(true);
					setSelectedRole(config.role || "default");
					setCustomRoleText(config.customRoleText || "");
					setTextContext(config.textContext || "");
					setUserFacts(config.userFacts?.join("\n") || "");
					const docs = await window.electronAPI.getDocuments();
					setDocuments(docs || []);

					const entries = await window.electronAPI.getAboutYouEntries();
					setAboutYouEntries(entries || []);
				} else {
					setPersonalizationAvailable(false);
					setDocuments([]);
					setAboutYouEntries([]);
				}
			} catch (error) {
				console.error("Error loading customize config:", error);
				setPersonalizationAvailable(false);
			}
		};

		loadConfig();
	}, []);

	// Show temporary status message
	const showStatus = useCallback(
		(type: "success" | "error", message: string) => {
			setSaveStatus({ type, message });
			setTimeout(() => setSaveStatus({ type: null, message: "" }), 3000);
		},
		[],
	);

	const requirePersonalization = (): boolean => {
		if (personalizationAvailable) return true;
		showStatus("error", PERSONALIZATION_DISABLED_MESSAGE);
		return false;
	};

	// Handle role change
	const handleRoleChange = async (role: string) => {
		if (!requirePersonalization()) return;
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
			} catch (error) {
				showStatus("error", "Failed to update role");
				setSelectedRole(previousRole);
			}
		}
	};

	// Handle custom role save
	const handleCustomRoleSave = async () => {
		if (!customRoleText.trim()) {
			showStatus("error", "Please enter a custom role description");
			return;
		}
		if (!requirePersonalization()) return;
		try {
			const result = await window.electronAPI.setRole("custom", customRoleText);
			if (result.success) {
				showStatus("success", "Custom role saved");
			} else {
				showStatus("error", result.error || "Failed to save custom role");
			}
		} catch (error) {
			showStatus("error", "Failed to save custom role");
		}
	};

	// Handle text context save
	const handleTextContextSave = async () => {
		if (!requirePersonalization()) return;
		try {
			const result = await window.electronAPI.setTextContext(textContext);
			if (result.success) {
				showStatus("success", "Context saved");
			} else {
				showStatus("error", result.error || "Failed to save context");
			}
		} catch (error) {
			showStatus("error", "Failed to save context");
		}
	};

	// Handle user facts save
	const handleUserFactsSave = async () => {
		if (!requirePersonalization()) return;
		try {
			const facts = userFacts
				.split("\n")
				.map((f) => f.trim())
				.filter(Boolean);
			const result = await window.electronAPI.setUserFacts(facts);
			if (result.success) {
				showStatus("success", "Notes saved");
			} else {
				showStatus("error", result.error || "Failed to save notes");
			}
		} catch (error) {
			showStatus("error", "Failed to save notes");
		}
	};

	// Handle file upload
	const handleFileUpload = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		if (!requirePersonalization()) return;

		setIsUploading(true);
		try {
			let uploadedCount = 0;
			let failedCount = 0;

			for (const file of Array.from(files)) {
				if (file.size > MAX_UPLOAD_BYTES) {
					failedCount += 1;
					continue;
				}

				setUploadStats((prev) => ({ ...prev, currentUploadName: file.name }));

				let result:
					| { success: boolean; data?: { id: string; status: string }; error?: string }
					| undefined;

				const bytes = new Uint8Array(await file.arrayBuffer());
				result = await window.electronAPI.uploadDocumentData({
					name: file.name,
					data: bytes,
					mimeType: file.type || undefined,
				});

				if (result.success && result.data) {
					uploadedCount += 1;
				} else {
					failedCount += 1;
					console.warn(
						"[CustomizePanel] Document upload failed:",
						file.name,
						result.error,
					);
				}
			}

			const docs = await window.electronAPI.getDocuments();
			setDocuments(docs || []);

			setUploadStats((prev) => ({
				uploadedThisSession: prev.uploadedThisSession + uploadedCount,
				currentUploadName: "",
			}));

			if (uploadedCount > 0 && failedCount === 0) {
				showStatus(
					"success",
					`Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}`,
				);
			} else if (uploadedCount > 0 && failedCount > 0) {
				showStatus(
					"error",
					`Uploaded ${uploadedCount}, failed ${failedCount}`,
				);
			} else if (failedCount > 0) {
				showStatus("error", "Upload failed");
			}
		} catch (error) {
			setUploadStats((prev) => ({ ...prev, currentUploadName: "" }));
			showStatus("error", "Failed to upload file");
		} finally {
			setIsUploading(false);
		}
	};

	// Handle document delete
	const handleDeleteDocument = async (docId: string) => {
		if (!requirePersonalization()) return;
		try {
			const result = await window.electronAPI.deleteDocument(docId);
			if (result.success) {
				setDocuments((docs) => docs.filter((d) => d.id !== docId));
				showStatus("success", "Document removed");
			} else {
				showStatus("error", result.error || "Failed to remove document");
			}
		} catch (error) {
			showStatus("error", "Failed to remove document");
		}
	};

	// ==================== About You Handlers ====================

	const handleAddTextEntry = async () => {
		if (!newEntryTitle.trim()) {
			showStatus("error", "Please enter a title");
			return;
		}
		if (!newEntryContent.trim()) {
			showStatus("error", "Please enter content");
			return;
		}
		if (!requirePersonalization()) return;

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
		} catch (error) {
			showStatus("error", "Failed to add entry");
		}
	};

	const handleAboutYouFileUpload = async (files: FileList | null) => {
		if (!files || files.length === 0) return;
		if (!newEntryTitle.trim()) {
			showStatus("error", "Please enter a title first");
			return;
		}
		if (!requirePersonalization()) return;

		setIsAboutYouUploading(true);
		try {
			const file = files[0];
			if (file.size > MAX_UPLOAD_BYTES) {
				showStatus("error", "File is too large");
				return;
			}

			setUploadStats((prev) => ({ ...prev, currentUploadName: file.name }));

			let result:
				| { success: boolean; data?: AboutYouEntry; error?: string }
				| undefined;

			const bytes = new Uint8Array(await file.arrayBuffer());
			result = await window.electronAPI.addAboutYouFileEntryData({
				title: newEntryTitle.trim(),
				name: file.name,
				data: bytes,
				mimeType: file.type || undefined,
			});

			if (result.success && result.data) {
				setAboutYouEntries((entries) => [...entries, result.data!]);
				setNewEntryTitle("");
				setIsAddingEntry(false);
				setUploadStats((prev) => ({
					uploadedThisSession: prev.uploadedThisSession + 1,
					currentUploadName: "",
				}));
				showStatus("success", `Added ${file.name}`);
			} else {
				setUploadStats((prev) => ({ ...prev, currentUploadName: "" }));
				showStatus("error", result.error || `Failed to add ${file.name}`);
			}
		} catch (error) {
			setUploadStats((prev) => ({ ...prev, currentUploadName: "" }));
			showStatus("error", "Failed to add file");
		} finally {
			setIsAboutYouUploading(false);
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
					entries.map((e) =>
						e.id === editingEntry.id ? result.data! : e,
					),
				);
				setEditingEntry(null);
				showStatus("success", "Entry updated");
			} else {
				showStatus("error", result.error || "Failed to update entry");
			}
		} catch (error) {
			showStatus("error", "Failed to update entry");
		}
	};

	const handleDeleteEntry = async (id: string) => {
		if (!requirePersonalization()) return;
		try {
			const result = await window.electronAPI.deleteAboutYouEntry(id);
			if (result.success) {
				setAboutYouEntries((entries) => entries.filter((e) => e.id !== id));
				showStatus("success", "Entry removed");
			} else {
				showStatus("error", result.error || "Failed to remove entry");
			}
		} catch (error) {
			showStatus("error", "Failed to remove entry");
		}
	};

	// ==================== Full Reset Handler ====================

	const handleFullReset = async () => {
		setIsResetting(true);
		try {
			const result = await window.electronAPI.fullResetCustomization();
			if (result.success) {
				setSelectedRole("default");
				setCustomRoleText("");
				setTextContext("");
				setDocuments([]);
				setUserFacts("");
				setAboutYouEntries([]);
				setShowResetConfirm(false);
				showStatus("success", "All settings reset");
			} else {
				showStatus("error", result.error || "Failed to reset");
			}
		} catch (error) {
			showStatus("error", "Failed to reset");
		} finally {
			setIsResetting(false);
		}
	};

	return (
		<div className="bg-black/60 backdrop-blur-xl border border-white/20 rounded-2xl p-4 w-full min-w-[300px] max-w-[420px]">
			{/* Header */}
			<div className="flex items-center justify-between mb-3 pb-3 border-b border-white/10">
				<h3 className="text-sm font-medium text-white/90">Customize</h3>
				<div className="flex items-center gap-2">
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

			{/* Status message */}
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

			{/* Personalization Disabled Banner */}
			{!personalizationAvailable && (
				<div className="text-xs px-3 py-2 rounded-lg mb-3 bg-yellow-500/10 text-yellow-300 border border-yellow-500/20">
					Add `SUPERMEMORY_API_KEY` to your `.env` and restart to enable
					personalization + file uploads.
				</div>
			)}

			{/* Upload Progress */}
			{uploadStats.currentUploadName && (
				<div className="text-xs px-3 py-2 rounded-lg mb-3 bg-yellow-500/10 text-yellow-300 flex items-center gap-2">
					<svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
						<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
						<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
					</svg>
					Uploading {uploadStats.currentUploadName}...
				</div>
			)}

			{/* Session Upload Stats */}
			{uploadStats.uploadedThisSession > 0 && (
				<div className="text-[10px] px-3 py-1.5 rounded-lg mb-3 bg-white/5 text-white/50">
					Documents uploaded this session: {uploadStats.uploadedThisSession}
				</div>
			)}

			{/* Reset Confirmation */}
			{showResetConfirm && (
				<div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-3">
					<div className="flex items-start gap-2">
						<IoWarning className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
						<div className="flex-1">
							<p className="text-xs text-white/90 font-medium">Reset All?</p>
							<p className="text-[10px] text-white/60 mt-1">
								This will delete all personal data and settings.
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

			{/* Scrollable Content */}
			<div className="max-h-[60vh] overflow-y-auto overflow-x-hidden pr-1 space-y-1">
				{/* About You Section */}
				<Section
					title="About You"
					icon={<IoPersonCircle className="w-4 h-4" />}
					defaultOpen={true}
					badge={aboutYouEntries.length}
				>
					<p className="text-[10px] text-white/40 mb-2">
						Personal info the assistant will remember.
					</p>

					{/* Add Entry Button */}
					{!isAddingEntry && (
						<button
							type="button"
							onClick={() => setIsAddingEntry(true)}
							disabled={!personalizationAvailable}
							className="w-full flex items-center justify-center gap-1 py-2 text-xs text-white/60 hover:text-white/80 hover:bg-white/5 rounded-lg transition-colors border border-dashed border-white/20"
						>
							<IoAdd className="w-3 h-3" />
							Add Entry
						</button>
					)}

					{/* Add Entry Form */}
					{isAddingEntry && (
						<div className="bg-white/5 rounded-lg p-3 space-y-2">
							<div className="flex gap-2 mb-2">
								<button
									type="button"
									onClick={() => setAddEntryType("text")}
									className={`flex-1 px-2 py-1 text-[10px] rounded-md transition-colors ${
										addEntryType === "text"
											? "bg-white/20 text-white"
											: "bg-white/5 text-white/50"
									}`}
								>
									Text
								</button>
								<button
									type="button"
									onClick={() => setAddEntryType("file")}
									className={`flex-1 px-2 py-1 text-[10px] rounded-md transition-colors ${
										addEntryType === "file"
											? "bg-white/20 text-white"
											: "bg-white/5 text-white/50"
									}`}
								>
									File
								</button>
							</div>

							<input
								type="text"
								value={newEntryTitle}
								onChange={(e) => setNewEntryTitle(e.target.value)}
								placeholder="Title (e.g., My Resume)"
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 placeholder-white/40"
							/>

							{addEntryType === "text" ? (
								<>
									<textarea
										value={newEntryContent}
										onChange={(e) => setNewEntryContent(e.target.value)}
										placeholder="Enter information..."
										className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[60px] resize-none placeholder-white/40"
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
											className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md"
										>
											Save
										</button>
									</div>
								</>
							) : (
								<>
									<FileDropZone
										accept=".pdf,.txt,.md,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.csv"
										disabled={
											isAboutYouUploading ||
											!newEntryTitle.trim() ||
											!personalizationAvailable
										}
										helperText={
											isAboutYouUploading ? "Uploading..." : "Drag file or"
										}
										onFilesSelected={handleAboutYouFileUpload}
									/>
									<div className="flex justify-end">
										<button
											type="button"
											onClick={() => {
												setIsAddingEntry(false);
												setNewEntryTitle("");
											}}
											className="px-2 py-1 text-[10px] text-white/50 hover:text-white/70"
										>
											Cancel
										</button>
									</div>
								</>
							)}
						</div>
					)}

					{/* Entry List */}
					{aboutYouEntries.length > 0 && (
						<div className="space-y-1 mt-2">
							{aboutYouEntries.map((entry) => (
								<div
									key={entry.id}
									className="bg-white/5 rounded-md p-2"
								>
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
											<div className="flex items-center gap-2 min-w-0 flex-1">
												{entry.type === "file" ? (
													<IoDocument className="w-3 h-3 text-white/50 flex-shrink-0" />
												) : (
													<IoDocumentText className="w-3 h-3 text-white/50 flex-shrink-0" />
												)}
													<div className="min-w-0 flex-1">
														<span className="text-[11px] font-medium text-white/80 block truncate">
															{entry.title}
														</span>
														<p className="text-[9px] text-white/40 truncate">
															{entry.type === "file"
																? entry.fileName || entry.content
																: entry.content.length > 50
																	? `${entry.content.substring(0, 50)}...`
																	: entry.content}
														</p>
													</div>
												</div>
												<div className="flex items-center gap-1 flex-shrink-0">
												{entry.type === "text" && (
													<button
														type="button"
														onClick={() => handleStartEdit(entry)}
														className="text-white/40 hover:text-white/70 p-0.5"
													>
														<IoCreate className="w-3 h-3" />
													</button>
												)}
												<button
													type="button"
													onClick={() => handleDeleteEntry(entry.id)}
													className="text-red-400/70 hover:text-red-400 p-0.5"
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

				{/* Role Section */}
				<Section
					title="Assistant Role"
					icon={<IoPersonCircle className="w-4 h-4" />}
				>
					<select
						value={selectedRole}
						onChange={(e) => handleRoleChange(e.target.value)}
						disabled={!personalizationAvailable}
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
								disabled={!personalizationAvailable}
								placeholder="Describe the role..."
								className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[60px] resize-none placeholder-white/40"
							/>
							<button
								type="button"
								onClick={handleCustomRoleSave}
								disabled={!personalizationAvailable}
								className="px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md"
							>
								Apply
							</button>
						</div>
					)}
				</Section>

				{/* Session Context Section */}
				<Section
					title="Session Context"
					icon={<IoDocumentText className="w-4 h-4" />}
				>
					<p className="text-[10px] text-white/40 mb-2">
						Temporary context for this session.
					</p>
					<textarea
						value={textContext}
						onChange={(e) => setTextContext(e.target.value)}
						disabled={!personalizationAvailable}
						placeholder="Meeting notes, background info..."
						className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[60px] resize-none placeholder-white/40"
					/>
					<button
						type="button"
						onClick={handleTextContextSave}
						disabled={!personalizationAvailable}
						className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md"
					>
						Save
					</button>
				</Section>

				{/* Documents Section */}
				<Section
					title="Session Documents"
					icon={<IoCloudUpload className="w-4 h-4" />}
					badge={documents.length}
				>
					<FileDropZone
						accept=".pdf,.txt,.md,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.csv"
						multiple
						disabled={isUploading || !personalizationAvailable}
						helperText={isUploading ? "Uploading..." : "Drag & drop or"}
						onFilesSelected={handleFileUpload}
					/>

					{documents.length > 0 && (
						<div className="space-y-1 mt-2">
							{documents.map((doc) => (
								<div
									key={doc.id}
									className="flex items-center justify-between bg-white/5 rounded-md px-2 py-1.5"
								>
									<div className="flex items-center gap-2 min-w-0 flex-1">
										<IoDocumentText className="w-3 h-3 text-white/50 flex-shrink-0" />
										<span className="text-[10px] text-white/70 truncate">
											{doc.name}
										</span>
									</div>
									<button
										type="button"
										onClick={() => handleDeleteDocument(doc.id)}
										className="text-red-400/70 hover:text-red-400 flex-shrink-0"
									>
										<IoTrash className="w-3 h-3" />
									</button>
								</div>
							))}
						</div>
					)}
				</Section>

				{/* Quick Notes Section */}
				<Section
					title="Quick Notes"
					icon={<IoDocumentText className="w-4 h-4" />}
				>
					<p className="text-[10px] text-white/40 mb-2">
						Preferences or facts (one per line).
					</p>
					<textarea
						value={userFacts}
						onChange={(e) => setUserFacts(e.target.value)}
						disabled={!personalizationAvailable}
						placeholder="- I prefer concise responses&#10;- My timezone is PST"
						className="w-full bg-white/10 text-white text-xs rounded-md px-2 py-1.5 border border-white/20 focus:outline-none focus:border-white/40 min-h-[60px] resize-none placeholder-white/40"
					/>
					<button
						type="button"
						onClick={handleUserFactsSave}
						disabled={!personalizationAvailable}
						className="mt-2 px-2 py-1 bg-white/10 hover:bg-white/20 text-white/90 text-[10px] rounded-md"
					>
						Save
					</button>
				</Section>
			</div>

			{/* Footer with Reset */}
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
