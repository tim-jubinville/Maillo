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

export interface PersonHit {
  name: string;
  email: string;
  photo?: string;
}

/** A person from Google Contacts, the Workspace directory or "Other contacts". */
export interface ContactCard {
  /** People API resource name (people/…, otherContacts/…), or '' when unknown. */
  id: string;
  source: 'contact' | 'directory' | 'other';
  name: string;
  emails: string[];
  phones: { value: string; type?: string }[];
  photo?: string;
  org?: string;
  title?: string;
  addresses: string[];
  birthday?: string;
  urls: string[];
  note?: string;
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
  /** The event's colour label on its calendar (Calendar's custom colours). */
  eventLabelId?: string;
  location?: string;
  description?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  /** Display colour: the event's own colour, or its calendar's. Filled by the backend. */
  color?: string;
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

/** Settings shared between devices (a hidden file in Drive's app folder). */
export interface SyncedSettings {
  version: 1;
  updated: number;
  prefs: Record<string, unknown>;
}

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
  /** Photo URLs by lower-case email address, from Google Contacts and the Workspace directory. */
  contactPhotos(): Promise<Record<string, string>>;
  /** As-you-type people search (contacts, Workspace directory, other contacts). Empty without the contacts feature. */
  searchPeople(q: string): Promise<PersonHit[]>;
  /** Your Google Contacts, sorted by first name. */
  listContacts(): Promise<ContactCard[]>;
  /** Full details for one address, from your contacts, the directory or other contacts. */
  findContact(email: string): Promise<ContactCard | null>;
  listLabels(): Promise<GLabel[]>;
  getLabel(id: string): Promise<GLabel>;
  createLabel(name: string): Promise<GLabel>;
  updateLabel(id: string, patch: Partial<GLabel>): Promise<GLabel>;
  deleteLabel(id: string): Promise<void>;
  listThreads(p: ListThreadsParams): Promise<GThreadList>;
  getThread(id: string, format: 'metadata' | 'full'): Promise<GThread>;
  /** Several threads' headers in one go (missing threads come back undefined). */
  getThreads(ids: string[]): Promise<(GThread | undefined)[]>;
  /** Several labels with their counts in one go. */
  getLabels(ids: string[]): Promise<(GLabel | undefined)[]>;
  /** Whether anything changed in the mailbox since a history ID, and the newest history ID. */
  history(startHistoryId: string): Promise<{ changed: boolean; historyId?: string }>;
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
  loadSettings(): Promise<SyncedSettings | null>;
  saveSettings(data: SyncedSettings): Promise<void>;
  loadNotes(): Promise<NotesMap>;
  saveNotes(notes: NotesMap): Promise<void>;
}
