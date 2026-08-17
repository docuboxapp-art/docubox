'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  ArrowUp,
  MessageSquare,
  Sparkles,
  Loader2,
  Plus,
  Mic,
  MicOff,
  FileText,
  Zap,
  Home,
  History,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import {
  getScopeFromRoute,
  ROUTE_ACTION_INTENTS,
  type LuciaScope,
} from '@/lib/ai/luciaIntentClassifier';
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

const LEGACY_SCOPE_MAP: Record<NonNullable<LucIAChatProps['scope']>, LuciaScope> = {
  workspace: 'workspace',
  document: 'document_viewer',
  expediente: 'documents',
  signatures: 'signing',
  tasks: 'pending_tasks',
  compliance: 'reports',
};

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
    return [
      'Agregar cláusula de confidencialidad',
      'Revisar términos de pago',
      '¿Cuáles son las obligaciones?',
    ];
  }
  if (content.includes('resum') || content.includes('resumen')) {
    return ['Extraer puntos clave', 'Identificar fechas importantes', 'Listar obligaciones'];
  }
  if (content.includes('firma') || content.includes('firmar')) {
    return [
      '¿Quiénes faltan por firmar?',
      'Ver estado de firmas',
      'Documentos pendientes de firma',
    ];
  }
  if (content.includes('documento') || content.includes('archivo')) {
    return [
      '¿Qué documentos están en revisión?',
      '¿Qué documentos vencen esta semana?',
      'Ver historial',
    ];
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

export default function LucIAChat({
  isOpen,
  onClose,
  documentId,
  expedienteId,
  scope = 'workspace',
  mode = 'authenticated',
  publicToken,
}: LucIAChatProps) {
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
  const routeScope = pathname ? getScopeFromRoute(pathname) : 'workspace';
  const currentScope: LuciaScope = scope === 'workspace' ? routeScope : LEGACY_SCOPE_MAP[scope];
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
    'resumir documento':
      'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 border-blue-200 dark:border-blue-800',
    'detectar riesgos':
      'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 border-amber-200 dark:border-amber-800',
    'revisar participantes':
      'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 border-green-200 dark:border-green-800',
    'mostrar historial':
      'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 border-purple-200 dark:border-purple-800',
    'ver auditoría':
      'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/40 border-purple-200 dark:border-purple-800',
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
            content:
              '⚠️ No se pudo autenticar la sesión. Por favor, recarga la página e intenta de nuevo.',
          };
          setMessages([...updatedMessages, errMsg]);
          setIsStreaming(false);
          return;
        }

        const routeDocumentId =
          documentId ||
          (() => {
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

  const {
    text: transcribedText,
    isLoading: isTranscribing,
    error: sttError,
    transcribe,
  } = useSpeechToText('OPEN_AI', 'gpt-4o-transcribe');

  useEffect(() => {
    if (sttError) toast.error('Error al transcribir audio: ' + sttError.message);
  }, [sttError]);

  useEffect(() => {
    if (transcribedText) {
      setInput((prev) => (prev ? prev + ' ' + transcribedText : transcribedText));
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

      if (sessErr) {
        setLoadingSessions(false);
        return;
      }
      if (!sessionRows || sessionRows.length === 0) {
        setSessions([]);
        setLoadingSessions(false);
        return;
      }

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

      setSessions(
        sessionRows.map((s: any) => ({
          id: s.id,
          title: s.title,
          messages: messagesBySession[s.id] || [],
          createdAt: new Date(s.created_at),
        }))
      );
    } catch {
      /* silent */
    } finally {
      setLoadingSessions(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (isOpen) {
      loadSessions();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, assistantText]);

  const saveSessionToSupabase = useCallback(
    async (updatedMessages: Message[], sessionId: string, sessionTitle: string) => {
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
            updatedMessages.map((m) => ({
              session_id: newId,
              user_id: user.id,
              role: m.role,
              content: m.content,
            }))
          );
          setSessions((prev) => [
            { id: newId, title: sessionTitle, messages: updatedMessages, createdAt: new Date() },
            ...prev,
          ]);
        } else {
          await supabase
            .from('lucia_sessions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', sessionId)
            .eq('user_id', user.id);
          await supabase.from('lucia_messages').insert(
            updatedMessages.slice(-2).map((m) => ({
              session_id: sessionId,
              user_id: user.id,
              role: m.role,
              content: m.content,
            }))
          );
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, messages: updatedMessages } : s))
          );
        }
      } catch {
        /* silent */
      } finally {
        setSavingSession(false);
      }
    },
    [user?.id]
  );

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
        const assistantMessage: Message = {
          role: 'assistant',
          content: answer,
          intent: data.intent,
          mode: data.mode,
        };
        setMessages([...updatedMessages, assistantMessage]);
      } catch (err: any) {
        const errMsg: Message = {
          role: 'assistant',
          content: `⚠️ No pude procesar tu consulta. ${err.message ? `Detalle: ${err.message}` : 'Por favor, intenta de nuevo.'}`,
        };
        setMessages((prev) => [...prev, errMsg]);
        toast.error(err.message || 'Error al consultar LucIA');
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    // ── Route: workspace-aware /api/ai/ask (always used when workspace available) ─────────────────────
    if (user && currentWorkspace?.id) {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) throw new Error('No session token');

        // Extract documentId from route if not passed as prop
        const routeDocumentId =
          documentId ||
          (() => {
            const visorMatch = pathname?.match(/^\/visor-documento\/([^/]+)/);
            const firmarMatch = pathname?.match(/^\/firmar-documento\/([^/]+)/);
            return visorMatch?.[1] || firmarMatch?.[1] || undefined;
          })();

        // Extract public token from route if applicable
        const routeToken = (() => {
          const tokenMatch = pathname?.match(/\/([^/]+)$/);
          const isTokenRoute =
            pathname?.startsWith('/portal-participante/') ||
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
        setMessages((prev) => [...prev, errMsg]);
        toast.error(err.message || 'Error al consultar LucIA');
      } finally {
        setIsStreaming(false);
      }
      return;
    }

    // ── Route: general streaming chat (fallback when no workspace) ──────────────────────────
    const apiMessages = [
      { role: 'system' as const, content: GENERAL_SYSTEM_PROMPT },
      ...updatedMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
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
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const startNewChat = () => {
    setMessages([]);
    setCurrentSessionId('');
    setAssistantText('');
    setShowHistory(false);
  };

  const loadSession = (session: ChatSession) => {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    setAssistantText('');
    setShowHistory(false);
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) return;
    await supabase.from('lucia_sessions').delete().eq('id', sessionId).eq('user_id', user.id);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      setMessages([]);
      setCurrentSessionId('');
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 112)}px`;
  }, [input]);

  if (!isOpen) return null;

  const contextLabel = isPublicTokenMode
    ? moduleConfig.name
    : currentWorkspace?.id
      ? moduleConfig.name
      : 'Ayuda general';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-[2px] sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lucia-dialog-title"
    >
      <div className="relative flex h-[min(760px,calc(100dvh-24px))] w-full max-w-[760px] flex-col overflow-hidden rounded-lg border border-[#EBEBF0] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] dark:border-slate-700 dark:bg-slate-900 sm:h-[min(760px,calc(100dvh-40px))]">
        {/* Header */}
        <div className="flex min-h-[68px] items-center justify-between gap-3 border-b border-[#EBEBF0] bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/50">
              <Sparkles className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <h2
                id="lucia-dialog-title"
                className="truncate text-base font-semibold text-[#18181B] dark:text-white"
              >
                Pregúntale a LucIA
              </h2>
              <p className="truncate text-xs text-[#64748B] dark:text-slate-400">
                Asistente inteligente de Docubox
              </p>
            </div>
          </div>
          <div className="flex flex-none items-center gap-1">
            <button
              onClick={() => {
                onClose();
                router.push('/inicio');
              }}
              className="hidden h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-[#52525B] transition-colors hover:bg-slate-100 hover:text-[#18181B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white sm:flex"
              title="Ir al menú principal"
            >
              <Home className="h-4 w-4" />
              <span className="hidden md:inline">Menú principal</span>
            </button>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                showHistory
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                  : 'text-[#52525B] hover:bg-slate-100 hover:text-[#18181B] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
              }`}
              title="Ver historial"
              aria-pressed={showHistory}
            >
              <History className="h-4 w-4" />
              <span className="hidden sm:inline">Historial</span>
            </button>
            <button
              onClick={startNewChat}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#52525B] transition-colors hover:bg-slate-100 hover:text-[#18181B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Nueva conversación"
              aria-label="Nueva conversación"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-slate-800 dark:hover:text-white"
              title="Cerrar"
              aria-label="Cerrar LucIA"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="flex min-h-0 flex-1 flex-col bg-[#F8F8FB] dark:bg-slate-950">
            <div className="flex items-center justify-between border-b border-[#EBEBF0] bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
              <div>
                <p className="text-sm font-semibold text-[#18181B] dark:text-white">
                  Conversaciones recientes
                </p>
                <p className="mt-0.5 text-xs text-[#64748B] dark:text-slate-400">
                  Retoma una consulta anterior
                </p>
              </div>
              <button
                onClick={startNewChat}
                className="flex h-9 items-center gap-2 rounded-lg border border-[#DDE3EC] bg-white px-3 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-400 dark:hover:bg-blue-950/50"
              >
                <Plus className="h-4 w-4" />
                Nueva
              </button>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-4 sm:p-5">
              {loadingSessions ? (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                </div>
              ) : sessions.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-[#EBEBF0] dark:bg-slate-900 dark:ring-slate-700">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-[#18181B] dark:text-white">
                    Aún no hay conversaciones
                  </p>
                  <p className="mt-1 max-w-xs text-sm text-[#64748B] dark:text-slate-400">
                    Tus consultas guardadas aparecerán aquí.
                  </p>
                </div>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`group relative w-full rounded-lg border bg-white transition-colors dark:bg-slate-900 ${
                      currentSessionId === session.id
                        ? 'border-blue-300 ring-1 ring-blue-100 dark:border-blue-700 dark:ring-blue-950'
                        : 'border-[#EBEBF0] hover:border-blue-200 hover:bg-blue-50/40 dark:border-slate-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20'
                    }`}
                  >
                    <button
                      onClick={() => loadSession(session)}
                      className="w-full rounded-lg px-4 py-3 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    >
                      <p className="truncate text-sm font-medium text-[#18181B] dark:text-slate-100">
                        {session.title}
                      </p>
                      <p className="mt-1 text-xs text-[#64748B] dark:text-slate-400">
                        {session.createdAt.toLocaleDateString('es-MX', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </button>
                    <button
                      onClick={(e) => deleteSession(session.id, e)}
                      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 opacity-100 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 dark:hover:bg-red-950/40"
                      title="Eliminar conversación"
                      aria-label="Eliminar conversación"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-[#EBEBF0] bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
              <button
                onClick={() => setShowHistory(false)}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-[#52525B] transition-colors hover:bg-slate-100 hover:text-[#18181B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                Volver al asistente
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Messages Area */}
        {!showHistory && (
          <div className="flex-1 space-y-5 overflow-y-auto bg-[#F8F8FB] px-4 py-5 dark:bg-slate-950 sm:px-6">
            {messages.length === 0 ? (
              <div className="mx-auto flex h-full w-full max-w-[540px] flex-col items-center justify-start pt-10 text-center sm:pt-16">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/50 dark:ring-blue-900">
                  <Sparkles className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                </div>
                <p className="text-lg font-semibold text-[#18181B] dark:text-white">
                  ¿Cómo puedo ayudarte?
                </p>
                <p className="mt-1 text-sm text-[#64748B] dark:text-slate-400">
                  Consulta información, documentos y tareas de tu espacio.
                </p>
                <span className="mt-3 inline-flex rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#52525B] ring-1 ring-[#EBEBF0] dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                  Contexto: {contextLabel}
                </span>
                {/* Quick suggestions from moduleCapabilities */}
                <div className="mt-7 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {quickSuggestions.slice(0, 4).map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="group flex min-h-12 items-center justify-between gap-3 rounded-lg border border-[#DDE3EC] bg-white px-3.5 py-2.5 text-left text-sm text-[#52525B] transition-colors hover:border-blue-300 hover:bg-blue-50/60 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
                    >
                      <span>{suggestion}</span>
                      <ChevronRight className="h-4 w-4 flex-none text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-500" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="mr-2 mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/50 dark:ring-blue-900">
                        <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                    )}
                    <div className="flex max-w-[85%] flex-col gap-1 sm:max-w-[78%]">
                      <div
                        className={`whitespace-pre-wrap rounded-lg px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-blue-600 text-white'
                            : 'border border-[#EBEBF0] bg-white text-[#27272A] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                        }`}
                      >
                        {msg.content}
                      </div>
                      {msg.role === 'assistant' && msg.intent && msg.intent !== 'general_help' && (
                        <div className="flex items-center gap-1 pl-1">
                          <FileText className="h-3 w-3 text-slate-400" />
                          <span className="text-xs text-slate-400">
                            {INTENT_LABELS[msg.intent] || msg.intent}
                          </span>
                          {msg.mode && msg.mode !== 'structured' && (
                            <span className="ml-1 text-xs text-blue-500">· RAG</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isBusy && (
                  <div className="flex justify-start">
                    <div className="mr-2 mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-950/50 dark:ring-blue-900">
                      <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="max-w-[85%] rounded-lg border border-[#EBEBF0] bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:max-w-[78%]">
                      {assistantText ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#27272A] dark:text-slate-200">
                          {assistantText}
                        </p>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span
                            className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                            style={{ animationDelay: '0ms' }}
                          />
                          <span
                            className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                            style={{ animationDelay: '150ms' }}
                          />
                          <span
                            className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"
                            style={{ animationDelay: '300ms' }}
                          />
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
        )}

        {/* Input Area */}
        {!showHistory && (
          <div className="border-t border-[#EBEBF0] bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900 sm:px-5">
            {savingSession && (
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
                <span className="text-xs text-slate-400">Guardando conversación...</span>
              </div>
            )}
            {isRecording && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs text-red-500 font-medium">
                  Grabando... toca el micrófono para detener
                </span>
              </div>
            )}
            {isTranscribing && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                <span className="text-xs text-blue-500">Transcribiendo audio...</span>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-lg border border-[#DDE3EC] bg-[#FAFBFC] p-2 transition-colors focus-within:border-blue-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:focus-within:border-blue-600 dark:focus-within:bg-slate-900 dark:focus-within:ring-blue-950">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  currentWorkspace?.id
                    ? 'Pregunta sobre tus documentos, tareas o firmas'
                    : 'Escribe tu consulta para LucIA'
                }
                rows={1}
                disabled={isBusy}
                aria-label="Escribe tu consulta para LucIA"
                className="max-h-28 min-h-10 flex-1 resize-none overflow-y-auto bg-transparent px-2 py-2.5 text-sm text-[#27272A] outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-200 dark:placeholder:text-slate-500"
                style={{ lineHeight: '1.5' }}
              />
              <button
                onClick={toggleRecording}
                disabled={isBusy || isTranscribing}
                title={isRecording ? 'Detener grabación' : 'Hablar con LucIA'}
                aria-label={isRecording ? 'Detener grabación' : 'Hablar con LucIA'}
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  isRecording
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isBusy}
                title="Enviar mensaje"
                aria-label="Enviar mensaje"
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
