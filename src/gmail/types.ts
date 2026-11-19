export interface GHeader {
  name: string;
  value: string;
}

export interface GBody {
  size: number;
  data?: string;
  attachmentId?: string;
}

export interface GPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: GHeader[];
  body?: GBody;
  parts?: GPart[];
}

export interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GPart;
  raw?: string;
}

export interface GThread {
  id: string;
  snippet?: string;
  historyId?: string;
  messages?: GMessage[];
}

export interface GLabelColor {
  backgroundColor?: string;
  textColor?: string;
}

export interface GLabel {
  id: string;
  name: string;
  type?: 'system' | 'user';
  messageListVisibility?: 'show' | 'hide';
  labelListVisibility?: 'labelShow' | 'labelShowIfUnread' | 'labelHide';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  color?: GLabelColor;
}

export interface GThreadList {
  threads?: { id: string; snippet?: string; historyId?: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GDraft {
  id: string;
  message: GMessage;
}

export interface GSendAs {
  sendAsEmail: string;
  displayName?: string;
  replyToAddress?: string;
  signature?: string;
  isPrimary?: boolean;
  isDefault?: boolean;
  verificationStatus?: string;
}

export interface GVacation {
  enableAutoReply: boolean;
  responseSubject?: string;
  responseBodyPlainText?: string;
  responseBodyHtml?: string;
  restrictToContacts?: boolean;
  restrictToDomain?: boolean;
  startTime?: string;
  endTime?: string;
}

export interface GFilterCriteria {
  from?: string;
  to?: string;
  subject?: string;
  query?: string;
  negatedQuery?: string;
  hasAttachment?: boolean;
  excludeChats?: boolean;
  size?: number;
  sizeComparison?: 'larger' | 'smaller';
}

export interface GFilterAction {
  addLabelIds?: string[];
  removeLabelIds?: string[];
  forward?: string;
}

export interface GFilter {
  id?: string;
  criteria: GFilterCriteria;
  action: GFilterAction;
}

export interface GProfile {
  emailAddress: string;
  messagesTotal?: number;
  threadsTotal?: number;
  historyId?: string;
}

export interface GUserInfo {
  name?: string;
  picture?: string;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
  colorId?: string;
}

export interface TaskItem {
  id: string;
  title?: string;
  notes?: string;
  due?: string;
  status?: 'needsAction' | 'completed';
}

export interface ThreadNote {
  text: string;
  updated: number;
}

export type NotesMap = Record<string, ThreadNote>;

export interface ListThreadsParams {
  q?: string;
  labelIds?: string[];
  pageToken?: string;
  maxResults?: number;
  includeSpamTrash?: boolean;
}

export interface MailBackend {
  readonly demo: boolean;
  profile(): Promise<GProfile>;
  userInfo(): Promise<GUserInfo>;
  listLabels(): Promise<GLabel[]>;
  getLabel(id: string): Promise<GLabel>;
  createLabel(name: string): Promise<GLabel>;
  updateLabel(id: string, patch: Partial<GLabel>): Promise<GLabel>;
  deleteLabel(id: string): Promise<void>;
  listThreads(p: ListThreadsParams): Promise<GThreadList>;
  getThread(id: string, format: 'metadata' | 'full'): Promise<GThread>;
  modifyThread(id: string, add: string[], remove: string[]): Promise<void>;
  trashThread(id: string): Promise<void>;
  untrashThread(id: string): Promise<void>;
  getAttachment(messageId: string, attachmentId: string): Promise<string>;
  getRawMessage(messageId: string): Promise<string>;
  send(raw: string, threadId?: string): Promise<GMessage>;
  listDrafts(): Promise<GDraft[]>;
  getDraft(id: string): Promise<GDraft>;
  createDraft(raw: string, threadId?: string): Promise<GDraft>;
  updateDraft(id: string, raw: string, threadId?: string): Promise<GDraft>;
  deleteDraft(id: string): Promise<void>;
  sendDraft(id: string): Promise<GMessage>;
  listSendAs(): Promise<GSendAs[]>;
  updateSendAs(email: string, patch: Partial<GSendAs>): Promise<GSendAs>;
  getVacation(): Promise<GVacation>;
  setVacation(v: GVacation): Promise<GVacation>;
  listFilters(): Promise<GFilter[]>;
  createFilter(f: GFilter): Promise<GFilter>;
  deleteFilter(id: string): Promise<void>;
  getImap(): Promise<{ enabled?: boolean }>;
  getPop(): Promise<{ accessWindow?: string }>;
  getAutoForwarding(): Promise<{ enabled?: boolean; emailAddress?: string }>;
  todayEvents(): Promise<CalendarEvent[]>;
  listTasks(): Promise<TaskItem[]>;
  addTask(title: string, notes?: string): Promise<TaskItem>;
  completeTask(id: string, done: boolean): Promise<void>;
  loadNotes(): Promise<NotesMap>;
  saveNotes(notes: NotesMap): Promise<void>;
}
