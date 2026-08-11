import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ArchiveRestore, ArrowLeft, Bold, Check, CheckSquare, ChevronDown, FileText, Italic, Link2, Lock, Moon, MoreHorizontal, Paperclip, Pin, Plus, Search, Settings2, Sun, Trash2, Undo2, Unlock, X } from 'lucide-react';
import { db, getAnonymousUser, isFirebaseConfigured } from './firebase';
import { deriveKey, decryptJson, encryptJson, hashPassword } from './crypto';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import './styles.css';

const LOCAL_NOTES = 'notlar.local.notes';
const LOCAL_SETTINGS = 'notlar.local.settings';
const DEFAULT_PASSWORD = '1234';
const blankContent = '<p><br></p>';
const DEFAULT_EDITOR_PREFERENCES = { editorFontSize: 20, editorLineHeight: 1.2, paragraphSpacing: 16 };
const SINGLE_USER_ID = 'private-notes';
const SESSION_UNLOCK = 'notlar.session.unlock';

function makeNote() {
  const now = Date.now();
  return { id: crypto.randomUUID(), title: '', content: blankContent, pinned: false, locked: false, deleted: false, createdAt: now, updatedAt: now };
}
function plainText(html = '') {
  const node = document.createElement('div'); node.innerHTML = html;
  return (node.textContent || '').replace(/\s+/g, ' ').trim();
}
function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(date);
}
function toMillis(value) { return value?.toMillis ? value.toMillis() : Number(value || 0); }
function sortNotes(notes) { return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || b.createdAt - a.createdAt); }
function readLocalNotes() { try { return JSON.parse(localStorage.getItem(LOCAL_NOTES) || '[]'); } catch { return []; } }
function readLocalSettings() { try { return JSON.parse(localStorage.getItem(LOCAL_SETTINGS) || '{}'); } catch { return {}; } }
function writeLocalNotes(notes) { localStorage.setItem(LOCAL_NOTES, JSON.stringify(notes)); }
function writeLocalSettings(settings) { localStorage.setItem(LOCAL_SETTINGS, JSON.stringify(settings)); }
function normalizeSettings(settings) { return { ...DEFAULT_EDITOR_PREFERENCES, ...settings }; }
function readSessionUnlock() { try { return sessionStorage.getItem(SESSION_UNLOCK) || ''; } catch { return ''; } }
function writeSessionUnlock(value) { try { sessionStorage.setItem(SESSION_UNLOCK, value); } catch {} }
function clearSessionUnlock() { try { sessionStorage.removeItem(SESSION_UNLOCK); } catch {} }

async function compressImage(file) {
  const source = await createImageBitmap(file); const canvas = document.createElement('canvas'); const max = 1024;
  let scale = Math.min(1, max / Math.max(source.width, source.height)); let quality = .62; let dataUrl = '';
  do {
    canvas.width = Math.max(1, Math.round(source.width * scale)); canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL('image/jpeg', quality); scale *= .8; quality = Math.max(.38, quality - .07);
  } while (dataUrl.length > 420000 && Math.max(canvas.width, canvas.height) > 384);
  source.close(); return dataUrl;
}
function insertHtmlAtSelection(html) { document.execCommand('insertHTML', false, html); }
function escapeHtml(value = '') { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]); }
function normalizeEditorBodyBlocks(editor) {
  if (!editor) return;
  [...editor.childNodes].forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && !['P', 'H1', 'H2', 'H3', 'UL', 'OL', 'IMG', 'DETAILS'].includes(node.tagName) && !node.classList.contains('note-collapse'))) {
      const paragraph = document.createElement('p');
      if (node.nodeType === Node.TEXT_NODE) paragraph.textContent = node.textContent;
      else while (node.firstChild) paragraph.append(node.firstChild);
      node.replaceWith(paragraph);
    }
  });
}
function sortChecklistItems(editor) {
  editor?.querySelectorAll('ul.checklist').forEach((list) => [...list.children].sort((a, b) => Number(b.querySelector('input')?.checked) - Number(a.querySelector('input')?.checked)).forEach((item) => list.appendChild(item)));
}
function currentEditableBlock(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor?.contains(selection.anchorNode)) return null;
  const node = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  const block = node?.closest('p, h1, h2, h3, li, .collapse-content');
  return block && block !== editor && editor.contains(block) ? block : null;
}
function syncCollapseBlocks(editor) {
  editor?.querySelectorAll('details.note-collapse').forEach((details) => {
    const body = details.querySelector(':scope > .collapse-body, :scope > div');
    const block = document.createElement('div');
    block.className = `note-collapse ${details.open ? 'is-expanded' : 'is-collapsed'}`;
    block.innerHTML = `<button class="collapse-toggle" type="button" contenteditable="false" aria-label="Collapsible bölümü aç veya kapat"></button><div class="collapse-content">${body?.innerHTML || '<br>'}</div>`;
    details.replaceWith(block);
  });
  editor?.querySelectorAll('.note-collapse').forEach((block) => {
    const toggle = block.querySelector(':scope > .collapse-toggle');
    if (toggle) toggle.textContent = block.classList.contains('is-collapsed') ? '▶' : '▼';
  });
  editor?.querySelectorAll('.collapse-content > br').forEach((br) => {
    const line = document.createElement('div');
    line.append(br.cloneNode());
    br.replaceWith(line);
  });
}
function focusAtEnd(element) {
  if (!element) return;
  element.closest('[contenteditable="true"]')?.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
function focusAtStart(element) {
  if (!element) return;
  element.closest('[contenteditable="true"]')?.focus();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}
function collapseContentAtSelection(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor?.contains(selection.anchorNode)) return null;
  const anchor = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  return anchor?.closest('.collapse-content');
}
function caretIsAtCollapseEnd(content) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !content.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  const after = document.createRange();
  after.selectNodeContents(content);
  after.setStart(range.endContainer, range.endOffset);
  return after.toString().trim() === '' && !after.cloneContents().querySelector('br');
}
function caretIsAtBlockStart(block) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !block?.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString() === '';
}
function caretIsAtBlockEnd(block) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed || !block?.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  const after = document.createRange();
  after.selectNodeContents(block);
  after.setStart(range.endContainer, range.endOffset);
  return after.toString() === '';
}
function collapseLineAtSelection(content) {
  const selection = window.getSelection();
  if (!content || !selection?.rangeCount) return null;
  let node = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  while (node?.parentElement && node.parentElement !== content) node = node.parentElement;
  return node?.parentElement === content ? node : null;
}
function insertCollapseLineBreak(editor) {
  const content = collapseContentAtSelection(editor);
  const selection = window.getSelection();
  if (!content || !selection?.rangeCount) return false;
  let line = collapseLineAtSelection(content);
  if (!line || line.tagName !== 'DIV') {
    line = document.createElement('div');
    while (content.firstChild) line.append(content.firstChild);
    content.append(line);
    focusAtEnd(line);
  }
  const range = selection.getRangeAt(0);
  const tail = document.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEnd(line, line.childNodes.length);
  const nextLine = document.createElement('div');
  nextLine.append(tail.extractContents());
  range.deleteContents();
  if (!line.childNodes.length) line.append(document.createElement('br'));
  if (!nextLine.childNodes.length) nextLine.append(document.createElement('br'));
  line.after(nextLine);
  focusAtStart(nextLine);
  return true;
}
function checklistItemAtSelection(editor) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor?.contains(selection.anchorNode)) return null;
  const node = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
  const item = node?.closest('ul.checklist > li');
  return item && editor.contains(item) ? item : null;
}
function makeChecklistItem() {
  const item = document.createElement('li');
  item.setAttribute('contenteditable', 'true');
  item.innerHTML = '<input type="checkbox" contenteditable="false" aria-label="Tamamlandı" /><span class="checklist-text" contenteditable="true"><br></span>';
  return item;
}
function checklistTextElement(item) {
  let text = item?.querySelector(':scope > .checklist-text');
  if (!text && item) { text = document.createElement('span'); text.className = 'checklist-text'; while (item.childNodes.length > 1) text.append(item.childNodes[1]); if (!text.childNodes.length) text.append(document.createElement('br')); item.append(text); }
  if (item) item.setAttribute('contenteditable', 'true');
  if (text) text.setAttribute('contenteditable', 'true');
  return text;
}
function checklistCaretIsInText(text) {
  const selection = window.getSelection();
  return !!(selection?.rangeCount && selection.isCollapsed && text?.contains(selection.anchorNode));
}
function specialBlockAtCaretStart(editor) {
  const collapse = collapseContentAtSelection(editor);
  if (collapse && caretIsAtBlockStart(collapse)) return collapse.closest('.note-collapse');
  const item = checklistItemAtSelection(editor);
  const text = checklistTextElement(item);
  if (item?.previousElementSibling === null && checklistCaretIsInText(text) && caretIsAtBlockStart(text)) return item.parentElement;
  const block = currentEditableBlock(editor);
  return block?.matches('p.single-style') && caretIsAtBlockStart(block) ? block : null;
}
function exitSpecialBlockAbove(block) {
  if (!block) return false;
  const paragraph = document.createElement('p');
  paragraph.append(document.createElement('br'));
  block.before(paragraph);
  focusAtStart(paragraph);
  return true;
}
function syncChecklistItems(editor) { editor?.querySelectorAll('ul.checklist > li').forEach((item) => { item.querySelector(':scope > input')?.setAttribute('contenteditable', 'false'); checklistTextElement(item); }); }
function selectEditorContents(editor) {
  if (!editor) return;
  const range = document.createRange(); range.selectNodeContents(editor);
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}
function selectionCoversEditor(editor) {
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount) return false;
  const range = selection.getRangeAt(0); const all = document.createRange(); all.selectNodeContents(editor);
  return range.compareBoundaryPoints(Range.START_TO_START, all) === 0 && range.compareBoundaryPoints(Range.END_TO_END, all) === 0;
}
function linkAtSelection(editor) {
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
  const link = node?.closest('a');
  return link && editor.contains(link) ? link : null;
}
function unlinkElement(link) {
  if (!link?.parentNode) return;
  while (link.firstChild) link.parentNode.insertBefore(link.firstChild, link);
  link.remove();
}

function NoteCard({ note, selected, onSelect }) {
  const preview = plainText(note.content) || 'Yeni not';
  return <button className={`note-card ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(note.id)}>
    <span className="note-card-top"><span className="note-card-title">{note.title || 'Başlıksız not'}</span><span className="note-card-icons">{note.locked && <Lock size={13} />}{note.pinned && <Pin size={13} fill="currentColor" />}</span></span>
    <span className="note-card-meta">{formatDate(note.updatedAt)} · {preview}</span>
  </button>;
}
function ToolbarButton({ label, onClick, active, children }) { return <button className={`toolbar-button ${active ? 'is-active' : ''}`} aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>; }

function App() {
  const [user, setUser] = useState(null); const [settings, setSettings] = useState(null); const [password, setPassword] = useState('');
  const [passwordInput, setPasswordInput] = useState(''); const [isUnlocked, setIsUnlocked] = useState(false); const [cryptoKey, setCryptoKey] = useState(null); const [unlockRestoreChecked, setUnlockRestoreChecked] = useState(false);
  const [unlockError, setUnlockError] = useState(''); const [notes, setNotes] = useState([]); const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState(''); const [view, setView] = useState('notes'); const [showSettings, setShowSettings] = useState(false); const [showInfo, setShowInfo] = useState(false);
  const [mobileList, setMobileList] = useState(true); const [notice, setNotice] = useState(''); const [previewImage, setPreviewImage] = useState(''); const [notePasswordModal, setNotePasswordModal] = useState(null); const [isSaving, setIsSaving] = useState(false); const [isLoading, setIsLoading] = useState(true); const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState(''); const [content, setContent] = useState(blankContent); const [linkContextMenu, setLinkContextMenu] = useState(null);
  const editorRef = useRef(null); const titleRef = useRef(null); const appRef = useRef(null); const fileRef = useRef(null); const saveTimer = useRef(null); const noteKeys = useRef(new Map());
  const selectedNote = notes.find((note) => note.id === selectedId) || null;
  const activeNotes = useMemo(() => sortNotes(notes.filter((note) => note.deleted === (view === 'trash'))).filter((note) => { const needle = search.trim().toLocaleLowerCase('tr-TR'); return !needle || `${note.title} ${plainText(note.content)}`.toLocaleLowerCase('tr-TR').includes(needle); }), [notes, search, view]);
  const showNotice = useCallback((message) => { setNotice(message); window.clearTimeout(showNotice.timer); showNotice.timer = window.setTimeout(() => setNotice(''), 2600); }, []);

  useEffect(() => { getAnonymousUser().then(setUser).catch(() => setUser({ uid: 'local-demo-user' })).finally(() => setIsLoading(false)); }, []);
  useEffect(() => {
    if (!user) return undefined; let unsubscribeNotes;
    async function loadSettings() {
      if (!isFirebaseConfigured) {
        const local = readLocalSettings();
        if (!local.passwordHash) { const initial = { passwordHash: await hashPassword(DEFAULT_PASSWORD), theme: 'light', salt: null, ...DEFAULT_EDITOR_PREFERENCES }; writeLocalSettings(initial); setSettings(initial); } else setSettings(normalizeSettings(local));
        setNotes(readLocalNotes()); setIsLoading(false); return;
      }
      const userRef = doc(db, 'users', SINGLE_USER_ID); const snapshot = await getDoc(userRef);
      if (snapshot.exists()) setSettings(normalizeSettings(snapshot.data())); else {
        const legacyRef = doc(db, 'users', user.uid); const legacySnapshot = await getDoc(legacyRef);
        const initial = legacySnapshot.exists() ? normalizeSettings(legacySnapshot.data()) : { passwordHash: await hashPassword(DEFAULT_PASSWORD), theme: 'light', salt: null, ...DEFAULT_EDITOR_PREFERENCES };
        await setDoc(userRef, initial);
        if (legacySnapshot.exists()) {
          const legacyNotes = await getDocs(collection(db, 'users', user.uid, 'notes'));
          await Promise.all(legacyNotes.docs.map((legacyNote) => setDoc(doc(db, 'users', SINGLE_USER_ID, 'notes', legacyNote.id), legacyNote.data())));
        }
        setSettings(initial);
      }
      unsubscribeNotes = onSnapshot(query(collection(db, 'users', SINGLE_USER_ID, 'notes'), orderBy('updatedAt', 'desc')), async (snapshot) => {
        const rows = [];
        for (const item of snapshot.docs) {
          const raw = item.data(); let decoded = { ...raw };
          const noteKey = raw.noteSalt ? noteKeys.current.get(item.id) : cryptoKey;
          if (raw.locked && noteKey && raw.encrypted) { try { decoded = { ...raw, ...(await decryptJson(raw.encrypted, noteKey)) }; } catch { decoded.title = 'Kilitli not'; decoded.content = '<p>Bu not şifreli.</p>'; } }
          else if (raw.locked) { decoded.title = 'Kilitli not'; decoded.content = '<p>Bu not şifreli.</p>'; }
          rows.push({ ...decoded, id: item.id, createdAt: toMillis(raw.createdAt), updatedAt: toMillis(raw.updatedAt) });
        }
        setNotes(rows);
      });
    }
    loadSettings().catch((error) => { setLoadError(error.code || error.message || 'Firebase erişimi reddedildi.'); setIsLoading(false); });
    return () => unsubscribeNotes?.();
  }, [user, cryptoKey, showNotice]);
  useEffect(() => {
    if (!settings || unlockRestoreChecked) return;
    let active = true;
    async function restoreUnlock() {
      const savedPassword = readSessionUnlock();
      if (savedPassword && await hashPassword(savedPassword) === settings.passwordHash) {
        const derived = await deriveKey(savedPassword, settings.salt || undefined);
        if (active) { setPassword(savedPassword); setCryptoKey(derived.key); setIsUnlocked(true); }
      } else if (savedPassword) clearSessionUnlock();
      if (active) setUnlockRestoreChecked(true);
    }
    restoreUnlock();
    return () => { active = false; };
  }, [settings, unlockRestoreChecked]);
  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme || 'light';
    const fontSize = Number(settings.editorFontSize) || DEFAULT_EDITOR_PREFERENCES.editorFontSize;
    const lineHeight = Number(settings.editorLineHeight);
    const normalizedLineHeight = Number.isFinite(lineHeight) ? lineHeight : DEFAULT_EDITOR_PREFERENCES.editorLineHeight;
    const paragraphSpacing = Number(settings.paragraphSpacing ?? DEFAULT_EDITOR_PREFERENCES.paragraphSpacing);
    document.documentElement.style.setProperty('--editor-font-size', `${fontSize}px`);
    document.documentElement.style.setProperty('--editor-line-height', String(normalizedLineHeight));
    document.documentElement.style.setProperty('--paragraph-spacing', `${paragraphSpacing}px`);
    document.documentElement.style.setProperty('--editor-effective-line-height', `${(fontSize * normalizedLineHeight) + paragraphSpacing}px`);
  }, [settings]);
  useEffect(() => { if (selectedNote) { setTitle(selectedNote.title || ''); setContent(selectedNote.content || blankContent); requestAnimationFrame(() => { if (editorRef.current) { editorRef.current.innerHTML = selectedNote.content || blankContent; normalizeEditorBodyBlocks(editorRef.current); syncCollapseBlocks(editorRef.current); syncChecklistItems(editorRef.current); } }); } }, [selectedId]);
  useEffect(() => {
    const closeMenu = (event) => { if (!event.target.closest?.('.link-context-menu')) setLinkContextMenu(null); };
    const closeOnEscape = (event) => { if (event.key === 'Escape') setLinkContextMenu(null); };
    document.addEventListener('pointerdown', closeMenu); document.addEventListener('keydown', closeOnEscape);
    return () => { document.removeEventListener('pointerdown', closeMenu); document.removeEventListener('keydown', closeOnEscape); };
  }, []);
  useEffect(() => { if (isUnlocked && selectedId && title === '' && titleRef.current) titleRef.current.focus(); }, [isUnlocked, selectedId, title]);
  useGSAP(() => {
    if (!isUnlocked) return;
    gsap.fromTo('.note-card', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .42, stagger: .035, ease: 'power2.out' });
    gsap.fromTo('.editor-shell', { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: .6, ease: 'power3.out' });
  }, { scope: appRef, dependencies: [isUnlocked, view, search] });

  const saveCurrent = useCallback(async (next = {}) => {
    if (!selectedNote || !user || !isUnlocked) return; const nextNote = { ...selectedNote, ...next, title: next.title ?? title, content: next.content ?? content, updatedAt: Date.now() };
    setNotes((current) => current.map((note) => note.id === nextNote.id ? nextNote : note)); setIsSaving(true);
    try {
      if (!isFirebaseConfigured) writeLocalNotes(notes.map((note) => note.id === nextNote.id ? nextNote : note));
      else { const payload = { ...nextNote }; delete payload.id; if (nextNote.locked) { const key = nextNote.noteSalt ? noteKeys.current.get(nextNote.id) : cryptoKey; if (!key) throw new Error('Kilitli not anahtarı bulunamadı.'); payload.encrypted = await encryptJson({ title: nextNote.title, content: nextNote.content }, key); payload.title = 'Kilitli not'; payload.content = '<p>Bu not şifreli.</p>'; } else { delete payload.encrypted; delete payload.notePasswordHash; delete payload.noteSalt; } await setDoc(doc(db, 'users', SINGLE_USER_ID, 'notes', nextNote.id), { ...payload, createdAt: nextNote.createdAt, updatedAt: nextNote.updatedAt }); }
    } catch { showNotice('Not kaydedilemedi.'); } finally { setIsSaving(false); }
  }, [content, cryptoKey, isUnlocked, notes, selectedNote, showNotice, title, user]);
  const scheduleSave = useCallback((next) => { window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => saveCurrent(next), 450); }, [saveCurrent]);
  const releaseSelectedNoteLock = async () => {
    if (!selectedNote?.locked || !noteKeys.current.has(selectedNote.id)) return;
    window.clearTimeout(saveTimer.current);
    await saveCurrent();
    noteKeys.current.delete(selectedNote.id);
    setNotes((current) => current.map((note) => note.id === selectedNote.id ? { ...note, title: 'Kilitli not', content: '<p>Bu not şifreli.</p>' } : note));
  };
  const createNote = async () => { await releaseSelectedNoteLock(); const newNote = makeNote(); setNotes((current) => [newNote, ...current]); setSelectedId(newNote.id); setView('notes'); setMobileList(false); if (!isFirebaseConfigured) writeLocalNotes([newNote, ...notes]); else await setDoc(doc(db, 'users', SINGLE_USER_ID, 'notes', newNote.id), { ...newNote }); requestAnimationFrame(() => titleRef.current?.focus()); };
  const updateTitle = (value) => { setTitle(value); scheduleSave({ title: value }); };
  const updateContent = () => { if (!editorRef.current) return; normalizeEditorBodyBlocks(editorRef.current); syncCollapseBlocks(editorRef.current); syncChecklistItems(editorRef.current); const value = editorRef.current.innerHTML || blankContent; setContent(value); scheduleSave({ content: value }); };
  const chooseNote = async (id) => { if (id !== selectedId) await releaseSelectedNoteLock(); const note = notes.find((item) => item.id === id); if (note?.locked && note.notePasswordHash && !noteKeys.current.has(id)) { setNotePasswordModal({ mode: 'unlock', noteId: id }); return; } setSelectedId(id); setMobileList(false); setShowInfo(false); };
  const mutateSelected = async (changes) => {
    if (!selectedNote) return; const next = { ...selectedNote, ...changes, updatedAt: Date.now() }; setNotes((current) => current.map((note) => note.id === next.id ? next : note));
    if (!isFirebaseConfigured) writeLocalNotes(notes.map((note) => note.id === next.id ? next : note));
    else { const payload = { ...next }; delete payload.id; if (next.locked) { const key = next.noteSalt ? noteKeys.current.get(next.id) : cryptoKey; if (!key) { showNotice('Not şifresi gerekli.'); return; } payload.encrypted = await encryptJson({ title: next.title, content: next.content }, key); payload.title = 'Kilitli not'; payload.content = '<p>Bu not şifreli.</p>'; } else { delete payload.encrypted; delete payload.notePasswordHash; delete payload.noteSalt; } await setDoc(doc(db, 'users', SINGLE_USER_ID, 'notes', next.id), payload); }
  };
  const toggleNoteLock = () => { if (!selectedNote) return; if (selectedNote.locked) { noteKeys.current.delete(selectedNote.id); mutateSelected({ locked: false, notePasswordHash: null, noteSalt: null }); } else setNotePasswordModal({ mode: 'lock', noteId: selectedNote.id }); };
  const submitNotePassword = async (value) => {
    const request = notePasswordModal; const note = notes.find((item) => item.id === request?.noteId); if (!request || !note) return 'Not bulunamadı.';
    if (request.mode === 'lock') { const derived = await deriveKey(value); noteKeys.current.set(note.id, derived.key); await mutateSelected({ locked: true, notePasswordHash: await hashPassword(value), noteSalt: derived.salt }); setNotePasswordModal(null); return ''; }
    if (await hashPassword(value) !== note.notePasswordHash) return 'Şifre hatalı.';
    try { const derived = await deriveKey(value, note.noteSalt); const decoded = await decryptJson(note.encrypted, derived.key); noteKeys.current.set(note.id, derived.key); setNotes((current) => current.map((item) => item.id === note.id ? { ...item, ...decoded } : item)); setSelectedId(note.id); setMobileList(false); setShowInfo(false); setNotePasswordModal(null); return ''; } catch { return 'Not açılamadı. Şifreyi kontrol et.'; }
  };
  const deleteSelected = async (permanent = false) => { if (!selectedNote) return; if (!permanent) await mutateSelected({ deleted: true, pinned: false }); else if (!isFirebaseConfigured) writeLocalNotes(notes.filter((note) => note.id !== selectedNote.id)); else await deleteDoc(doc(db, 'users', SINGLE_USER_ID, 'notes', selectedNote.id)); setNotes((current) => current.filter((note) => note.id !== selectedNote.id)); setSelectedId(null); setMobileList(true); setShowInfo(false); };
  const handleUnlock = async (event) => { event.preventDefault(); if (!settings || !passwordInput) return; if (await hashPassword(passwordInput) !== settings.passwordHash) { setUnlockError('Şifre hatalı.'); return; } const derived = await deriveKey(passwordInput, settings.salt || undefined); setPassword(passwordInput); setCryptoKey(derived.key); setIsUnlocked(true); writeSessionUnlock(passwordInput); setUnlockError(''); };
  const changePassword = async (nextPassword) => {
    const normalized = nextPassword.trim(); if (normalized.length < 4) { showNotice('Şifre en az 4 karakter olmalı.'); return false; }
    const derived = await deriveKey(normalized); const nextSettings = { ...settings, passwordHash: await hashPassword(normalized), salt: derived.salt }; setSettings(nextSettings); setPassword(normalized); setCryptoKey(derived.key); writeSessionUnlock(normalized);
    if (!isFirebaseConfigured) writeLocalSettings(nextSettings); else await setDoc(doc(db, 'users', SINGLE_USER_ID), nextSettings, { merge: true });
    for (const note of notes.filter((item) => item.locked && !item.noteSalt)) if (isFirebaseConfigured) await setDoc(doc(db, 'users', SINGLE_USER_ID, 'notes', note.id), { title: 'Kilitli not', content: '<p>Bu not şifreli.</p>', encrypted: await encryptJson({ title: note.title, content: note.content }, derived.key), locked: true, deleted: note.deleted, pinned: note.pinned, createdAt: note.createdAt, updatedAt: note.updatedAt });
    showNotice('Şifre güncellendi.'); return true;
  };
  const logout = () => { window.clearTimeout(saveTimer.current); clearSessionUnlock(); setPassword(''); setPasswordInput(''); setCryptoKey(null); setSelectedId(null); setShowInfo(false); setShowSettings(false); setIsUnlocked(false); };
  const toggleTheme = async () => { const next = { ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' }; setSettings(next); if (!isFirebaseConfigured) writeLocalSettings(next); else await setDoc(doc(db, 'users', SINGLE_USER_ID), next, { merge: true }); };
  const updateEditorPreferences = async (preferences) => { const next = { ...settings, ...preferences }; setSettings(next); if (!isFirebaseConfigured) writeLocalSettings(next); else await setDoc(doc(db, 'users', SINGLE_USER_ID), preferences, { merge: true }); showNotice('Yazı düzeni kaydedildi.'); };
  const applyFormat = (command, value = null) => { const editor = editorRef.current; editor?.focus(); currentEditableBlock(editor)?.classList.remove('single-style'); document.execCommand(command, false, value); updateContent(); };
  const applyBodyText = () => { const editor = editorRef.current; editor?.focus(); document.execCommand('formatBlock', false, 'p'); currentEditableBlock(editor)?.classList.remove('single-style'); updateContent(); };
  const applySingleStyle = () => { const editor = editorRef.current; editor?.focus(); document.execCommand('formatBlock', false, 'p'); const block = currentEditableBlock(editor); if (block) block.classList.add('single-style'); else insertHtmlAtSelection('<p class="single-style"><br></p>'); updateContent(); };
  const addLink = () => {
    const editor = editorRef.current; const selection = window.getSelection();
    if (!editor || !selection?.rangeCount || selection.isCollapsed || !editor.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    const link = linkAtSelection(editor);
    if (link) unlinkElement(link);
    else { const url = selection.toString().trim(); if (!url) return; document.execCommand('createLink', false, url); }
    setLinkContextMenu(null); updateContent();
  };
  const addChecklist = () => { const editor = editorRef.current; editor?.focus(); insertHtmlAtSelection('<ul class="checklist"><li contenteditable="true"><input type="checkbox" contenteditable="false" aria-label="Tamamlandı" /><span class="checklist-text" contenteditable="true"><br></span></li></ul><p><br></p>'); updateContent(); requestAnimationFrame(() => { const lists = editor?.querySelectorAll('ul.checklist'); focusAtStart(checklistTextElement(lists?.[lists.length - 1]?.lastElementChild)); }); };
  const addCollapse = () => { const editor = editorRef.current; editor?.focus(); document.execCommand('insertParagraph'); insertHtmlAtSelection('<div class="note-collapse is-expanded"><button class="collapse-toggle" type="button" contenteditable="false" aria-label="Collapsible bölümü aç veya kapat">▼</button><div class="collapse-content"><div><br></div></div></div><p><br></p>'); updateContent(); requestAnimationFrame(() => { const blocks = editor?.querySelectorAll('.note-collapse'); focusAtEnd(blocks?.[blocks.length - 1]?.querySelector('.collapse-content > div')); }); };
  const addImage = async (file) => { if (!file || !file.type.startsWith('image/')) return; try { const dataUrl = await compressImage(file); if (dataUrl.length > 450000) { showNotice('Görsel hâlâ çok büyük. Daha küçük bir görsel seç.'); return; } editorRef.current?.focus(); insertHtmlAtSelection(`<img class="note-image" src="${dataUrl}" alt="Not görseli" />`); updateContent(); } catch { showNotice('Görsel eklenemedi.'); } };
  const handlePaste = (event) => {
    const image = [...(event.clipboardData?.files || [])].find((file) => file.type.startsWith('image/'));
    if (image) { event.preventDefault(); addImage(image); return; }
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const html = lines.map((line) => `<p>${line ? escapeHtml(line) : '<br>'}</p>`).join('');
    insertHtmlAtSelection(html);
    updateContent();
  };
  const handleEditorClick = (event) => { const link = event.target.closest?.('a'); if (link && editorRef.current?.contains(link)) { event.preventDefault(); window.open(link.href, '_blank', 'noopener,noreferrer'); return; } if (event.target.matches('img.note-image')) { event.preventDefault(); setPreviewImage(event.target.src); return; } const toggle = event.target.closest('.collapse-toggle'); if (toggle) { event.preventDefault(); const block = toggle.closest('.note-collapse'); block.classList.toggle('is-collapsed'); block.classList.toggle('is-expanded'); toggle.textContent = block.classList.contains('is-collapsed') ? '▶' : '▼'; updateContent(); return; } if (event.target.matches('.checklist input')) window.setTimeout(() => { sortChecklistItems(editorRef.current); updateContent(); }, 0); };
  const handleEditorContextMenu = (event) => { const link = event.target.closest?.('a'); if (!link || !editorRef.current?.contains(link)) return; event.preventDefault(); setLinkContextMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 52), link }); };
  const removeContextLink = () => { const link = linkContextMenu?.link; if (link && editorRef.current?.contains(link)) { unlinkElement(link); updateContent(); } setLinkContextMenu(null); };
  const handleEditorKeyDown = (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); selectEditorContents(editorRef.current); return; }
    if ((event.key === 'Backspace' || event.key === 'Delete') && selectionCoversEditor(editorRef.current)) { event.preventDefault(); editorRef.current.innerHTML = ''; updateContent(); return; }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); addLink(); return; }
    const collapseContent = collapseContentAtSelection(editorRef.current);
    const checklistItem = checklistItemAtSelection(editorRef.current);
    const specialBlock = specialBlockAtCaretStart(editorRef.current);
    if (specialBlock && event.key === 'ArrowLeft') {
      event.preventDefault(); exitSpecialBlockAbove(specialBlock); updateContent(); return;
    }
    if (checklistItem) {
      const checklistText = checklistTextElement(checklistItem);
      const caretIsInChecklistText = checklistCaretIsInText(checklistText);
      if (!caretIsInChecklistText && (event.key === 'Backspace' || event.key === 'Delete')) {
        event.preventDefault(); focusAtStart(checklistText); return;
      }
      if (event.key === 'Enter') {
        event.preventDefault(); const nextItem = makeChecklistItem(); checklistItem.after(nextItem); focusAtStart(checklistTextElement(nextItem)); updateContent(); return;
      }
      if (event.key === 'Backspace' && caretIsInChecklistText && !checklistText.textContent.trim() && caretIsAtBlockStart(checklistText)) {
        event.preventDefault(); const list = checklistItem.parentElement; const previous = checklistItem.previousElementSibling; const next = checklistItem.nextElementSibling; checklistItem.remove();
        if (!list?.children.length) { const paragraph = document.createElement('p'); paragraph.append(document.createElement('br')); list?.replaceWith(paragraph); focusAtStart(paragraph); }
        else focusAtEnd(checklistTextElement(previous || next));
        updateContent(); return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey && !caretIsInChecklistText) focusAtStart(checklistText);
    }
    const currentBlock = currentEditableBlock(editorRef.current);
    if (event.key === 'Backspace' && currentBlock?.matches('p, h1, h2, h3') && !currentBlock.textContent.trim() && caretIsAtBlockStart(currentBlock)) {
      const previous = currentBlock.previousElementSibling;
      if (!previous && currentBlock.nextElementSibling) { event.preventDefault(); const next = currentBlock.nextElementSibling; currentBlock.remove(); focusAtStart(next); updateContent(); return; }
      if (previous?.matches('ul.checklist')) { event.preventDefault(); currentBlock.remove(); focusAtEnd(checklistTextElement(previous.lastElementChild)); updateContent(); return; }
    }
    const checklistIsAtNoteEnd = checklistItem?.parentElement === editorRef.current?.lastElementChild && checklistItem === checklistItem.parentElement.lastElementChild;
    const singleStyleIsAtNoteEnd = currentBlock?.matches('p.single-style') && currentBlock === editorRef.current?.lastElementChild;
    if (event.key === 'ArrowDown' && (checklistIsAtNoteEnd ? caretIsAtBlockEnd(checklistTextElement(checklistItem)) : singleStyleIsAtNoteEnd && caretIsAtBlockEnd(currentBlock))) {
      event.preventDefault();
      const paragraph = document.createElement('p');
      paragraph.append(document.createElement('br'));
      (checklistItem?.parentElement || currentBlock).after(paragraph);
      focusAtStart(paragraph);
      updateContent();
      return;
    }
    if (event.key === 'ArrowDown' && collapseContent) {
      const line = collapseLineAtSelection(collapseContent);
      if (line?.nextElementSibling) { event.preventDefault(); focusAtStart(line.nextElementSibling); return; }
      if (line && !line.nextElementSibling && caretIsAtCollapseEnd(collapseContent)) {
        event.preventDefault();
        const block = collapseContent.closest('.note-collapse');
        let nextLine = block?.nextElementSibling;
        if (!nextLine || nextLine.classList.contains('note-collapse')) {
          nextLine = document.createElement('p');
          nextLine.append(document.createElement('br'));
          block?.after(nextLine);
          updateContent();
        }
        focusAtStart(nextLine);
        return;
      }
    }
    if (event.key === 'Enter' && collapseContent) { event.preventDefault(); insertCollapseLineBreak(editorRef.current); updateContent(); }
    if (event.key === 'Enter' && currentBlock?.matches('p.single-style')) { event.preventDefault(); document.execCommand('insertLineBreak'); updateContent(); }
  };
  const handleEditorBeforeInput = (event) => {
    if (event.inputType !== 'insertParagraph') return;
    if (collapseContentAtSelection(editorRef.current)) { event.preventDefault(); insertCollapseLineBreak(editorRef.current); updateContent(); }
    else if (currentEditableBlock(editorRef.current)?.matches('p.single-style')) { event.preventDefault(); document.execCommand('insertLineBreak'); updateContent(); }
  };

  if (isLoading || !settings || !unlockRestoreChecked) return <div className="loading-screen"><div className="brand-mark">n</div><p>{loadError ? 'Firebase not kasasına erişilemedi.' : 'Notlar hazırlanıyor'}</p>{loadError && <><span className="load-error-code">{loadError}</span><button className="primary-button" onClick={() => window.location.reload()}>Yeniden dene</button></>}</div>;
  if (!isUnlocked) return <main className="lock-screen"><div className="lock-orbit orbit-one" /><div className="lock-orbit orbit-two" /><form className="lock-card" onSubmit={handleUnlock}><div className="brand-mark">n</div><p className="eyebrow">Kişisel not alanın</p><h1>Fikirlerini sakla.<br /><em>Geri dön.</em></h1><p className="lock-copy">Notlarına ulaşmak için şifreni gir.</p><input autoFocus type="password" inputMode="numeric" value={passwordInput} onChange={(event) => setPasswordInput(event.target.value)} placeholder="Şifre" aria-label="Notlar şifresi" />{unlockError && <p className="form-error">{unlockError}</p>}<button className="primary-button" type="submit">Notları aç <Unlock size={16} /></button><span className="lock-hint">İlk kullanım şifresi: 1234</span></form></main>;

  return <main className="app-shell" ref={appRef}>
    <aside className={`notes-panel ${mobileList ? 'mobile-visible' : ''}`}><header className="panel-header"><div><p className="eyebrow">Not defteri</p><h2>{view === 'trash' ? 'Çöp kutusu' : 'Notlar'}</h2></div><div className="header-actions"><button className="icon-button" onClick={createNote} aria-label="Yeni not" title="Yeni not"><Plus size={20} /></button><button className="icon-button" onClick={() => setShowSettings(true)} aria-label="Ayarlar" title="Ayarlar"><Settings2 size={18} /></button></div></header>
      <div className="search-wrap"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Notlarda ara" aria-label="Notlarda ara" /></div>
      <div className="view-switcher"><button className={view === 'notes' ? 'active' : ''} onClick={async () => { await releaseSelectedNoteLock(); setView('notes'); setSelectedId(null); }}>Tüm notlar <span>{notes.filter((n) => !n.deleted).length}</span></button><button className={view === 'trash' ? 'active' : ''} onClick={async () => { await releaseSelectedNoteLock(); setView('trash'); setSelectedId(null); }}><Trash2 size={15} /> Çöp kutusu <span>{notes.filter((n) => n.deleted).length}</span></button></div>
      <div className="notes-list">{activeNotes.length ? activeNotes.map((note) => <NoteCard key={note.id} note={note} selected={note.id === selectedId} onSelect={chooseNote} />) : <div className="empty-list"><FileText size={30} /><p>{search ? 'Eşleşen not yok.' : view === 'trash' ? 'Çöp kutusu boş.' : 'İlk notunu oluştur.'}</p></div>}</div>
      <footer className="panel-footer"><span className={`sync-dot ${isSaving ? 'is-syncing' : ''}`} />{isFirebaseConfigured ? (isSaving ? 'Firebase ile eşitleniyor' : 'Firebase ile eşitlendi') : 'Yerel demo modu'}</footer>
    </aside>
    <section className={`editor-shell ${mobileList ? 'mobile-hidden' : ''}`}>
      {!selectedNote ? <div className="empty-editor"><button className="back-button mobile-only" onClick={() => setMobileList(true)}><ArrowLeft size={17} /> Notlar</button><div className="empty-editor-orbit" /><FileText size={35} strokeWidth={1.3} /><h1>Bir fikir yaz.</h1><p>Yeni bir not aç veya listeden bir not seç.</p><button className="primary-button" onClick={createNote}><Plus size={16} /> Yeni not</button></div> : <><header className="editor-header"><button className="back-button mobile-only" onClick={async () => { await releaseSelectedNoteLock(); setMobileList(true); }}><ArrowLeft size={17} /> Notlar</button><span className="updated-label">{isSaving ? 'Kaydediliyor…' : `Son düzenleme ${formatDate(selectedNote.updatedAt, true)}`}</span><div className="editor-header-actions">{view === 'trash' ? <button className="icon-button soft" title="Geri yükle" aria-label="Geri yükle" onClick={() => mutateSelected({ deleted: false })}><Undo2 size={18} /></button> : <button className={`icon-button soft ${selectedNote.pinned ? 'is-active' : ''}`} title="Sabitle" aria-label="Sabitle" onClick={() => mutateSelected({ pinned: !selectedNote.pinned })}><Pin size={18} fill={selectedNote.pinned ? 'currentColor' : 'none'} /></button>}<button className="icon-button soft" title="Not bilgisi" aria-label="Not bilgisi" onClick={() => setShowInfo((value) => !value)}><MoreHorizontal size={20} /></button></div>{showInfo && <div className="info-popover"><strong>Not bilgisi</strong><span>Oluşturuldu: {formatDate(selectedNote.createdAt, true)}</span><span>Son düzenleme: {formatDate(selectedNote.updatedAt, true)}</span><span>{selectedNote.locked ? 'Bu not şifreli' : 'Bu not şifresiz'}</span></div>}</header>
        <div className="editor-toolbar" role="toolbar" aria-label="Biçimlendirme araçları"><ToolbarButton label="Büyük başlık" onClick={() => applyFormat('formatBlock', 'h1')}><span className="type-label large">A</span></ToolbarButton><ToolbarButton label="Orta başlık" onClick={() => applyFormat('formatBlock', 'h2')}><span className="type-label medium">A</span></ToolbarButton><ToolbarButton label="Küçük başlık" onClick={() => applyFormat('formatBlock', 'h3')}><span className="type-label small">A</span></ToolbarButton><ToolbarButton label="Body text" onClick={applyBodyText}><span className="type-label body">T</span></ToolbarButton><ToolbarButton label="Tek stil" onClick={applySingleStyle}><span className="type-label single">A</span></ToolbarButton><span className="toolbar-divider" /><ToolbarButton label="Kalın" onClick={() => applyFormat('bold')}><Bold size={17} /></ToolbarButton><ToolbarButton label="İtalik" onClick={() => applyFormat('italic')}><Italic size={17} /></ToolbarButton><ToolbarButton label="Yapılacaklar listesi" onClick={addChecklist}><CheckSquare size={18} /></ToolbarButton><ToolbarButton label="Collapsible bölüm ekle" onClick={addCollapse}><ChevronDown size={19} /></ToolbarButton><ToolbarButton label="Bağlantı ekle/kaldır (Ctrl+K)" onClick={addLink}><Link2 size={18} /></ToolbarButton><ToolbarButton label="Görsel ekle" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></ToolbarButton><input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => addImage(event.target.files?.[0])} /><span className="toolbar-spacer" /><ToolbarButton label={selectedNote.locked ? 'Not şifresini kaldır' : 'Notu şifrele'} active={selectedNote.locked} onClick={toggleNoteLock}>{selectedNote.locked ? <Unlock size={18} /> : <Lock size={17} />}</ToolbarButton>{view === 'trash' ? <ToolbarButton label="Kalıcı sil" onClick={() => deleteSelected(true)}><Trash2 size={18} /></ToolbarButton> : <ToolbarButton label="Çöp kutusuna taşı" onClick={() => deleteSelected(false)}><Trash2 size={18} /></ToolbarButton>}</div>
        <article className="note-editor"><input ref={titleRef} className="note-title-input" value={title} onChange={(event) => updateTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); editorRef.current?.focus(); } }} placeholder="Başlık" aria-label="Not başlığı" /><div ref={editorRef} className="content-editor" contentEditable suppressContentEditableWarning onInput={updateContent} onPasteCapture={handlePaste} onClick={handleEditorClick} onContextMenu={handleEditorContextMenu} onKeyDownCapture={handleEditorKeyDown} onBeforeInputCapture={handleEditorBeforeInput} data-placeholder="Notunu buraya yaz…" /></article></>}
    </section>
    {linkContextMenu && <div className="link-context-menu" style={{ left: linkContextMenu.x, top: linkContextMenu.y }} role="menu"><button type="button" role="menuitem" onClick={removeContextLink}>Bağlantıyı kaldır</button></div>}{notice && <div className="toast"><Check size={15} /> {notice}</div>}{previewImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Görsel önizleme" onMouseDown={(event) => event.target === event.currentTarget && setPreviewImage('')}><button className="image-lightbox-close" onClick={() => setPreviewImage('')} aria-label="Görseli kapat"><X size={20} /></button><img src={previewImage} alt="Not görseli büyük önizleme" /></div>}{notePasswordModal && <NotePasswordModal mode={notePasswordModal.mode} onClose={() => setNotePasswordModal(null)} onSubmit={submitNotePassword} />}{showSettings && <SettingsModal settings={settings} onClose={() => setShowSettings(false)} onTheme={toggleTheme} onPassword={changePassword} onEditorPreferences={updateEditorPreferences} onLogout={logout} />}
  </main>;
}

function SettingsModal({ settings, onClose, onTheme, onPassword, onEditorPreferences, onLogout }) {
  const [nextPassword, setNextPassword] = useState(''); const [confirmPassword, setConfirmPassword] = useState(''); const [error, setError] = useState('');
  const [editorFontSize, setEditorFontSize] = useState(String(settings.editorFontSize || DEFAULT_EDITOR_PREFERENCES.editorFontSize));
  const [editorLineHeight, setEditorLineHeight] = useState(String(settings.editorLineHeight ?? DEFAULT_EDITOR_PREFERENCES.editorLineHeight));
  const [paragraphSpacing, setParagraphSpacing] = useState(String(settings.paragraphSpacing ?? DEFAULT_EDITOR_PREFERENCES.paragraphSpacing));
  const submit = async (event) => { event.preventDefault(); if (nextPassword !== confirmPassword) { setError('Şifreler eşleşmiyor.'); return; } if (await onPassword(nextPassword)) { setNextPassword(''); setConfirmPassword(''); } };
  const saveEditorPreferences = async (event) => { event.preventDefault(); const typedLineHeight = Number(editorLineHeight); const lineHeight = Number.isFinite(typedLineHeight) ? typedLineHeight : DEFAULT_EDITOR_PREFERENCES.editorLineHeight; setEditorLineHeight(String(lineHeight)); await onEditorPreferences({ editorFontSize: Number(editorFontSize), editorLineHeight: lineHeight, paragraphSpacing: Number(paragraphSpacing) }); };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-modal">
      <header><div><p className="eyebrow">Not defteri</p><h2>Ayarlar</h2></div><button className="icon-button" onClick={onClose} aria-label="Kapat"><X size={19} /></button></header>
      <div className="settings-row"><div><strong>Görünüm</strong><span>Not defterinin renk temasını seç.</span></div><button className="theme-toggle" onClick={onTheme}>{settings.theme === 'dark' ? <><Moon size={17} /> Koyu</> : <><Sun size={17} /> Açık</>}</button></div>
      <form className="editor-preferences" onSubmit={saveEditorPreferences}>
        <div><strong>Yazı düzeni</strong><span>Bu seçimler tüm notların body metnine uygulanır.</span></div>
        <label>Metin boyutu<select value={editorFontSize} onChange={(event) => setEditorFontSize(event.target.value)}><option value="16">Küçük — 16 px</option><option value="18">Orta — 18 px</option><option value="20">Normal — 20 px</option><option value="22">Büyük — 22 px</option><option value="24">Çok büyük — 24 px</option></select></label>
        <div className="line-spacing-control"><div className="line-spacing-title"><span>Satır aralığı</span><output>{Number.isFinite(Number(editorLineHeight)) ? `${Number(editorLineHeight).toFixed(2)}×` : '—'}</output></div><div className="line-spacing-inputs"><input type="number" step="0.01" value={editorLineHeight} onChange={(event) => setEditorLineHeight(event.target.value)} aria-label="Satır aralığı değeri" /></div><span className="line-spacing-help">İstediğin değeri yazabilirsin; sınır yok. Örnek: 0.70, 1.20 veya 3.00.</span></div>
        <label>Ek satır boşluğu<select value={paragraphSpacing} onChange={(event) => setParagraphSpacing(event.target.value)}><option value="0">Yok</option><option value="8">Dar</option><option value="16">Normal</option><option value="24">Geniş</option></select></label>
        <button className="primary-button" type="submit">Yazı düzenini kaydet</button>
      </form>
      <form className="password-form" onSubmit={submit}><div><strong>Giriş şifresi</strong><span>Uygulama açılırken sorulan şifreyi değiştir.</span></div><input type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="Yeni şifre" minLength="4" /><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Yeni şifre tekrar" minLength="4" />{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">Şifreyi güncelle</button></form>
      <button className="logout-button" type="button" onClick={onLogout}>Çıkış yap</button>
      <p className="security-note"><Lock size={14} /> Şifreli notlar tarayıcıda AES-GCM ile korunur. Şifreni unutursan şifreli içerikler kurtarılamaz.</p>
    </section>
  </div>;
}

function NotePasswordModal({ mode, onClose, onSubmit }) {
  const [value, setValue] = useState(''); const [error, setError] = useState('');
  const submit = async (event) => { event.preventDefault(); if (mode === 'lock' && value.length < 4) { setError('Şifre en az 4 karakter olmalı.'); return; } const result = await onSubmit(value); if (result) setError(result); };
  const isLocking = mode === 'lock';
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="note-password-modal" autoComplete="off" onSubmit={submit}><header><div><p className="eyebrow">{isLocking ? 'Notu kilitle' : 'Kilitli not'}</p><h2>{isLocking ? 'Bir şifre belirle' : 'Notun şifresini gir'}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Kapat"><X size={19} /></button></header><p>{isLocking ? 'Bu not yalnızca belirleyeceğin şifreyle açılabilir.' : 'Bu notu açmak için kendine ait şifreyi gir.'}</p><input autoFocus className="note-secret-input" type="text" name="note-access-code" autoComplete="off" autoCapitalize="none" spellCheck="false" data-1p-ignore="true" data-lpignore="true" value={value} onChange={(event) => setValue(event.target.value)} placeholder="Not şifresi" aria-label="Not şifresi" />{error && <span className="form-error">{error}</span>}<button className="primary-button" type="submit">{isLocking ? 'Notu kilitle' : 'Notu aç'}</button></form></div>;
}

createRoot(document.getElementById('root')).render(<App />);
