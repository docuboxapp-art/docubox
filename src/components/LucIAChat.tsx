'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, MessageSquare, Sparkles, Loader2, Plus, Mic, MicOff, FileText, Zap, Home } from 'lucide-react';
import { getScopeFromRoute, ROUTE_ACTION_INTENTS } from '@/lib/ai/luciaIntentClassifier';
import { getQuickSuggestions, getLuciaModuleConfig } from '@/lib/ai/moduleCapabilities';
import { useSpeechToText } from '@/lib/hooks/useSpeechToText';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import toast from 'react-hot-toast';
import { getStreamingChatCompletion } from '@/lib/ai/chatCompletion';
import { usePathname, useRouter } from 'next/navigation';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  intent?: string;
  mode?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
}

interface LucIAChatProps {
  isOpen: boolean;
  onClose: () => void;
  documentId?: string;
  expedienteId?: string;
  scope?: 'workspace' | 'document' | 'expediente' | 'signatures' | 'tasks' | 'compliance';
  /** Set to "public-token" for public token routes (portal, form, enrollment, etc.) */
  mode?: 'authenticated' | 'public-token';
  /** The public token from the URL — used when mode="public-token" */
  publicToken?: string;
}

const GENERAL_SYSTEM_PROMPT = `Eres LucIA, la asistente inteligente de DocuBox. Ayudas a los usuarios con:
- Chat de ayuda y soporte general de DocuBox
- Resumen de documentos legales y contractuales
- Explicación simple de términos legales complejos
- Extracción de datos clave de documentos
- Clasificación de documentos por tipo y categoría
- Generación de contratos simples y plantillas
- Búsqueda inteligente de información en documentos

Responde siempre en español de manera clara, profesional y concisa.`;

function getProactiveSuggestions(messages: Message[]): string[] {
  if (messages.length === 0) {
    return [
      '¿Quién creó este documento?',
      'Documentos pendientes de firma',
      'Resume este contrato',
      'Detectar riesgos legales',
    ];
  }
  const lastMsg = messages[messages.length - 1];
  const content = lastMsg.content.toLowerCase();

  if (content.includes('contrato') || content.includes('acuerdo')) {
    return ['Agregar cláusula de confidencialidad', 'Revisar términos de pago', '¿Cuáles son las obligaciones?'];
  }
  if (content.includes('resum') || content.includes('resumen')) {
    return ['Extraer puntos clave', 'Identificar fechas importantes', 'Listar obligaciones'];
  }
  if (content.includes('firma') || content.includes('firmar')) {
    return ['¿Quiénes faltan por firmar?', 'Ver estado de firmas', 'Documentos pendientes de firma'];
  }
  if (content.includes('documento') || content.includes('archivo')) {
    return ['¿Qué documentos están en revisión?', '¿Qué documentos vencen esta semana?', 'Ver historial'];
  }
  if (lastMsg.role === 'assistant') {
    return ['Explícame más', '¿Cómo lo aplico?', 'Dame un ejemplo', 'Siguiente paso'];
  }
  return ['Continuar con esto', 'Cambiar de tema', 'Ver más opciones'];
}

const INTENT_LABELS: Record<string, string> = {
  metadata_search: 'Búsqueda de metadatos',
  document_status_search: 'Estado de documentos',
  signature_status: 'Estado de firmas',
  pending_tasks: 'Tareas pendientes',
  expediente_search: 'Búsqueda en expediente',
  document_content_search: 'Contenido documental',
  document_summary: 'Resumen',
  legal_analysis: 'Análisis legal',
  compliance_analysis: 'Cumplimiento',
  contract_generation: 'Generación de contrato',
  general_help: 'Ayuda general',
};

export default function LucIAChat({ isOpen, onClose, documentId, expedienteId, scope = 'workspace', mode = 'authenticated', publicToken }: LucIAChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [assistantText, setAssistantText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const supabase = createClient();
  const { user } = useAuth();
  const { activeWorkspace: currentWorkspace } = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();

  // ── Route-context callable actions ────────────────────────────────────────
  const currentScope = pathname ? getScopeFromRoute(pathname) : 'workspace';
  const scopeActions = ROUTE_ACTION_INTENTS[currentScope];
  const callableActions = scopeActions ? Object.entries(scopeActions) : [];

  // ── Module capabilities for current route ─────────────────────────────────
  const moduleConfig = getLuciaModuleConfig(currentScope);
  const quickSuggestions = getQuickSuggestions(currentScope);

  // ── Public token mode: use token-scoped context ────────────────────────────
  const isPublicTokenMode = mode === 'public-token';

  // Action icons for document_viewer actions
  const ACTION_ICONS: Record<string, React.ReactNode> = {
    'resumir documento': <FileText className="w-3 h-3" />,
    'detectar riesgos': <Zap className="w-3 h-3" />,
    'revisar participantes': <MessageSquare className="w-3 h-3" />,
    'mostrar historial': <Sparkles className="w-3 h-3" />,
    'ver auditoría': <Sparkles className="w-3 h-3" />,
  };

  const ACTION_COLORS: Record<string, string> = {
    'resumir documento': 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 border-blue-200 dark:border-blue-800',
    'detectar riesgos': 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 border-amber-200 dark:border-amber-800',
    'revisar participantes': 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 border-green-200 dark:border-green-800',
    'mostrar historial': 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 border-purple-200 dark:border-purple-800',
    'ver auditoría': 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 border-purple-200 dark:border-purple-800',
  };

  const proactiveSuggestions = getProactiveSuggestions(messages);
  const isBusy = isStreaming;

  const triggerAction = (actionKey: string, actionIntent: { question: string }) => {
    if (isBusy) return;
    setInput(actionIntent.question);
    // Auto-send immediately
    const text = actionIntent.question;
    const userMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setAssistantText('');
    setIsStreaming(true);

    if (user && currentWorkspace?.id) {
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        const token = session?.access_token;
        if (!token) {
          const errMsg: Message = {
            role: 'assistant',
            content: '⚠️ No se pudo autenticar la sesión. Por favor, recarga la página e intenta de nuevo.',
          };
          setMessages([...updatedMessages, errMsg]);
          setIsStreaming(false);
          return;
        }

        const routeDocumentId = documentId || (() => {
          const visorMatch = pathname?.match(/^\/visor-documento\/([^/]+)/);
          const firmarMatch = pathname?.match(/^\/firmar-documento\/([^/]+)/);
          return visorMatch?.[1] || firmarMatch?.[1] || undefined;
        })();

        try {
          const res = await fetch('/api/ai/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              question: text,
              workspaceId: currentWorkspace.id,
              currentRoute: pathname ?? '/',
              documentId: routeDocumentId,
              expedienteId: expedienteId || undefined,
              scope: currentScope || 'workspace',
              uiState: {
                hasDocumentContext: !!routeDocumentId,
                scope: currentScope || 'workspace',
                pathname: pathname ?? '/',
                moduleConfig: { name: moduleConfig.name, entities: moduleConfig.entities },
              },
              sessionId: currentSessionId || undefined,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Error ${res.status}`);
          }

          const data = await res.json();
          const answer = data.answer || 'No se pudo generar una respuesta.';
          const assistantMessage: Message = { role: 'assistant', content: answer, intent: data.intent, mode: data.mode };
          const finalMessages = [...updatedMessages, assistantMessage];
          setMessages(finalMessages);
          const title = updatedMessages[0]?.content?.slice(0, 50) || 'Nueva conversación';
          await saveSessionToSupabase(finalMessages, currentSessionId, title);
        } catch (err: any) {
          const errorLabel: Record<string, string> = {
            'resumir documento': 'resumir el documento',
            'detectar riesgos': 'detectar riesgos',
            'revisar participantes': 'revisar los participantes',
            'mostrar historial': 'mostrar el historial',
          };
          const actionLabel = errorLabel[actionKey] || actionKey;
          const errMsg: Message = {
            role: 'assistant',
            content: `⚠️ No pude ${actionLabel} en este momento. ${err.message ? `Detalle: ${err.message}` : 'Por favor, intenta de nuevo más tarde.'}`,
          };
          setMessages([...updatedMessages, errMsg]);
          toast.error(err.message || 'Error al ejecutar acción');
        } finally {
          setIsStreaming(false);
        }
      });
    } else {
      setIsStreaming(false);
    }
  };

  const { text: transcribedText, isLoading: isTranscribing, error: sttError, transcribe } = useSpeechToText('OPEN_AI', 'gpt-4o-transcribe');

  useEffect(() => {
    if (sttError) toast.error('Error al transcribir audio: ' + sttError.message);
  }, [sttError]);

  useEffect(() => {
    if (transcribedText) {
      setInput(prev => prev ? prev + ' ' + transcribedText : transcribedText);
      inputRef.current?.focus();
    }
  }, [transcribedText]);

  const loadSessions = useCallback(async () => {
    if (!user) return;
    setLoadingSessions(true);
    try {
      const { data: sessionRows, error: sessErr } = await supabase
        .from('lucia_sessions')
        .select('id, title, created_at, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(30);

      if (sessErr) { setLoadingSessions(false); return; }
      if (!sessionRows || sessionRows.length === 0) { setSessions([]); setLoadingSessions(false); return; }

      const sessionIds = sessionRows.map((s: any) => s.id);
      const { data: msgRows } = await supabase
        .from('lucia_messages')
        .select('id, session_id, role, content, created_at')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true });

      const messagesBySession: Record<string, Message[]> = {};
      (msgRows || []).forEach((m: any) => {
        if (!messagesBySession[m.session_id]) messagesBySession[m.session_id] = [];
        messagesBySession[m.session_id].push({ role: m.role, content: m.content });
      });

      setSessions(sessionRows.map((s: any) => ({
        id: s.id,
        title: s.title,
        messages: messagesBySession[s.id] || [],
        createdAt: new Date(s.created_at),
      })));
    } catch { /* silent */ } finally { setLoadingSessions(false); }
  }, [user?.id]);

  useEffect(() => {
    if (isOpen) { loadSessions(); setTimeout(() => inputRef.current?.focus(), 100); }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, assistantText]);

  const saveSessionToSupabase = useCallback(async (updatedMessages: Message[], sessionId: string, sessionTitle: string) => {
    if (!user || updatedMessages.length === 0) return;
    setSavingSession(true);
    try {
      if (!sessionId) {
        const { data: newSession, error: sessErr } = await supabase
          .from('lucia_sessions')
          .insert({ user_id: user.id, title: sessionTitle })
          .select('id')
          .single();
        if (sessErr || !newSession) return;
        const newId = newSession.id;
        setCurrentSessionId(newId);
        await supabase.from('lucia_messages').insert(
          updatedMessages.map(m => ({ session_id: newId, user_id: user.id, role: m.role, content: m.content }))
        );
        setSessions(prev => [{ id: newId, title: sessionTitle, messages: updatedMessages, createdAt: new Date() }, ...prev]);
      } else {
        await supabase.from('lucia_sessions').update({ updated_at: new Date().toISOString() }).eq('id', sessionId).eq('user_id', user.id);
        await supabase.from('lucia_messages').insert(
          updatedMessages.slice(-2).map(m => ({ session_id: sessionId, user_id: user.id, role: m.role, content: m.content }))
        );
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: updatedMessages } : s));
      }
    } catch { /* silent */ } finally { setSavingSession(false); }
  }, [user?.id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const userMessage: Message = { role: 'user', content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setAssistantText('');
    setIsStreaming(true);

    // ── Public token mode: send to backend with token context, no workspace auth ──
    if (isPublicTokenMode && publicToken) {
      try {
        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: text,
            currentRoute: pathname ?? '/',
            token: publicToken,
            scope: currentScope || 'workspace',
            mode: 'public-token',
            uiState: {
              hasTokenContext: true,
              scope: currentScope || 'workspace',
              pathname: pathname ?? '/',
              moduleConfig: { name: moduleConfig.name, entities: moduleConfig.entities },
            },
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Error ${res.status}`);
        }

        const data = await res.json();
        const answer = data.answer || 'No se pudo generar una respuesta.';
        const assistantMessage: Message = { role: 'assistant', content: answer, intent: data.intent, mode: data.mode };
        setMessages([...updatedMessages, assistantMessage]);
      } catch (err: any) {
        const errMsg: Message = {
          role: 'assistant',
          content: `⚠️ No pude procesar tu consulta. ${err.message ? `Detalle: ${err.message}` : 'Por favor, intenta de nuevo.'}`,
        };
        setMessages(prev => [...prev, errMsg]);
        toast.error(err.message || 'Error al consultar LucIA');
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    // ── Route: workspace-aware /api/ai/ask (always used when workspace available) ─────────────────────
    if (user && currentWorkspace?.id) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('No session token');

        // Extract documentId from route if not passed as prop
        const routeDocumentId = documentId || (() => {
          const visorMatch = pathname?.match(/^\/visor-documento\/([^/]+)/);
          const firmarMatch = pathname?.match(/^\/firmar-documento\/([^/]+)/);
          return visorMatch?.[1] || firmarMatch?.[1] || undefined;
        })();

        // Extract public token from route if applicable
        const routeToken = (() => {
          const tokenMatch = pathname?.match(/\/([^/]+)$/);
          const isTokenRoute = pathname?.startsWith('/portal-participante/') ||
            pathname?.startsWith('/registro-participante/') ||
            pathname?.startsWith('/form/') ||
            pathname?.startsWith('/enrolamiento/') ||
            pathname?.startsWith('/subir-movil/') ||
            pathname?.startsWith('/captura-id-movil/');
          return isTokenRoute ? tokenMatch?.[1] : undefined;
        })();

        // Derive scope from current route
        const derivedScope = currentScope || 'workspace';

        // Build uiState from visible context
        const uiState: Record<string, any> = {
          hasDocumentContext: !!routeDocumentId,
          hasTokenContext: !!routeToken,
          scope: derivedScope,
          pathname: pathname ?? '/',
          moduleConfig: { name: moduleConfig.name, entities: moduleConfig.entities },
        };

        console.log('LucIA currentRoute', pathname);
        console.log('LucIA scope', derivedScope);
        console.log('LucIA documentId', routeDocumentId);
        console.log('LucIA moduleConfig', moduleConfig.name);

        const res = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            question: text,
            workspaceId: currentWorkspace.id,
            currentRoute: pathname ?? '/',
            documentId: routeDocumentId,
            expedienteId: expedienteId || undefined,
            token: routeToken,
            scope: derivedScope,
            uiState,
            sessionId: currentSessionId || undefined,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Error ${res.status}`);
        }

        const data = await res.json();
        const answer = data.answer || 'No se pudo generar una respuesta.';
        const assistantMessage: Message = {
          role: 'assistant',
          content: answer,
          intent: data.intent,
          mode: data.mode,
        };
        const finalMessages = [...updatedMessages, assistantMessage];
        setMessages(finalMessages);
        const title = updatedMessages[0]?.content?.slice(0, 50) || 'Nueva conversación';
        await saveSessionToSupabase(finalMessages, currentSessionId, title);
      } catch (err: any) {
        const errMsg: Message = {
          role: 'assistant',
          content: `⚠️ No pude procesar tu consulta en este momento. ${err.message ? `Detalle: ${err.message}` : 'Por favor, intenta de nuevo más tarde.'}`,
        };
        setMessages(prev => [...prev, errMsg]);
        toast.error(err.message || 'Error al consultar LucIA');
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    // ── Route: general streaming chat (fallback when no workspace) ──────────────────────────
    const apiMessages = [
      { role: 'system' as const, content: GENERAL_SYSTEM_PROMPT },
      ...updatedMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    let fullAssistantText = '';
    try {
      await getStreamingChatCompletion(
        'OPEN_AI',
        'gpt-4o-mini',
        apiMessages,
        (chunk: any) => {
          const content = chunk?.choices?.[0]?.delta?.content;
          if (content) {
            fullAssistantText += content;
            setAssistantText(fullAssistantText);
          }
        },
        async () => {
          if (fullAssistantText) {
            const assistantMessage: Message = { role: 'assistant', content: fullAssistantText };
            const finalMessages = [...updatedMessages, assistantMessage];
            setMessages(finalMessages);
            setAssistantText('');
            const title = updatedMessages[0]?.content?.slice(0, 50) || 'Nueva conversación';
            await saveSessionToSupabase(finalMessages, currentSessionId, title);
          } else {
            toast.error('LucIA no devolvió una respuesta. Intenta de nuevo.');
          }
          setIsStreaming(false);
        },
        (err: Error) => {
          toast.error(err.message || 'Error al obtener respuesta de LucIA');
          setIsStreaming(false);
        },
        { max_completion_tokens: 2048 }
      );
    } catch {
      toast.error('Error de conexión con LucIA');
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });
        await transcribe(audioFile, { language: 'es' });
      };
      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      toast.error('No se pudo acceder al micrófono. Verifica los permisos.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) { mediaRecorderRef.current.stop(); setIsRecording(false); }
  };

  const toggleRecording = () => { isRecording ? stopRecording() : startRecording(); };

  const startNewChat = () => { setMessages([]); setCurrentSessionId(''); setAssistantText(''); setShowHistory(false); };

  const loadSession = (session: ChatSession) => {
    setMessages(session.messages); setCurrentSessionId(session.id); setAssistantText(''); setShowHistory(false);
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    await supabase.from('lucia_sessions').delete().eq('id', sessionId).eq('user_id', user.id);
    setSessions(prev => prev.filter(s => s.id !== sessionId));
    if (currentSessionId === sessionId) { setMessages([]); setCurrentSessionId(''); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div
        className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ height: '640px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Pregúntale a LucIA</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Asistente inteligente Docubox</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onClose(); router.push('/documents-dashboard'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              Menú principal
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Historial
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="absolute inset-0 z-10 bg-white dark:bg-gray-900 flex flex-col" style={{ top: '73px' }}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Historial de conversaciones</span>
              <button onClick={startNewChat} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400">
                <Plus className="w-3.5 h-3.5" />
                Nueva conversación
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {loadingSessions ? (
                <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 text-blue-400 animate-spin" /></div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">No hay conversaciones guardadas</div>
              ) : (
                sessions.map(session => (
                  <button
                    key={session.id}
                    onClick={() => loadSession(session)}
                    className="w-full text-left px-4 py-3 rounded-xl border border-gray-100 dark:border-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group relative"
                  >
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate pr-6">{session.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {session.createdAt.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      className="absolute right-3 top-3 w-5 h-5 flex items-center justify-center rounded text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </button>
                ))
              )}
            </div>
            <div className="p-3 border-t border-gray-100 dark:border-gray-800">
              <button onClick={() => setShowHistory(false)} className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                Volver al chat
              </button>
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-gray-50/50 dark:bg-gray-950/50">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-50 dark:from-blue-900/40 dark:to-blue-800/20 flex items-center justify-center mb-4">
                <Sparkles className="w-7 h-7 text-blue-500" />
              </div>
              <p className="text-gray-700 dark:text-gray-300 text-sm font-semibold">¿Cómo puedo ayudarte hoy?</p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1 mb-4">
                {isPublicTokenMode
                  ? `Asistente para ${moduleConfig.name}`
                  : currentWorkspace?.id
                  ? `Estás en: ${moduleConfig.name}`
                  : 'Escribe, habla o elige una sugerencia'}
              </p>
              {/* Quick suggestions from moduleCapabilities */}
              <div className="flex flex-col gap-2 w-full max-w-xs">
                {quickSuggestions.slice(0, 3).map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                    className="text-left px-3 py-2 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-200 dark:hover:border-blue-700 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                      <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1 max-w-[80%]">
                    <div
                      className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                        msg.role === 'user' ?'bg-blue-600 text-white rounded-br-sm' :'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-bl-sm shadow-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                    {msg.role === 'assistant' && msg.intent && msg.intent !== 'general_help' && (
                      <div className="flex items-center gap-1 pl-1">
                        <FileText className="w-3 h-3 text-gray-400" />
                        <span className="text-xs text-gray-400">{INTENT_LABELS[msg.intent] || msg.intent}</span>
                        {msg.mode && msg.mode !== 'structured' && (
                          <span className="text-xs text-blue-400 ml-1">· RAG</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isBusy && (
                <div className="flex justify-start">
                  <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center mr-2 flex-shrink-0 mt-0.5">
                    <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  </div>
                  <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm max-w-[80%]">
                    {assistantText ? (
                      <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap">{assistantText}</p>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* suggestions and callable actions removed */}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="px-4 py-3 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
          {savingSession && (
            <div className="flex items-center gap-1.5 mb-1.5 px-1">
              <Loader2 className="w-3 h-3 text-gray-400 animate-spin" />
              <span className="text-xs text-gray-400">Guardando conversación...</span>
            </div>
          )}
          {isRecording && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span className="text-xs text-red-500 font-medium">Grabando... toca el micrófono para detener</span>
            </div>
          )}
          {isTranscribing && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
              <span className="text-xs text-blue-500">Transcribiendo audio...</span>
            </div>
          )}
          <div className="flex items-end gap-2 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                currentWorkspace?.id
                  ? 'Ej: "¿Quién creó este documento?" o "Resume el contrato"'
                  : 'Ej: "¿Cómo funciona la firma electrónica?"'
              }
              rows={1}
              disabled={isBusy}
              className="flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 resize-none outline-none max-h-28 overflow-y-auto py-0.5"
              style={{ lineHeight: '1.5' }}
            />
            <button
              onClick={toggleRecording}
              disabled={isBusy || isTranscribing}
              title={isRecording ? 'Detener grabación' : 'Hablar con LucIA'}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors flex-shrink-0 ${
                isRecording
                  ? 'bg-red-500 hover:bg-red-600 text-white' :'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {isRecording ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={handleSend}
              disabled={!input.trim() || isBusy}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white transition-colors flex-shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
