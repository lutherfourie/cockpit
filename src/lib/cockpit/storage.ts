import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assistantEventsFromChatMessages,
  parseAssistantEventRows,
  type AppendAssistantEventInput,
  type AssistantEvent,
} from "./assistant-events";
import type { ThoughtChatHistoryMessage, ThoughtChatRole } from "./thought-chat";
import type { CockpitAgentOutput } from "./schema";

export type SessionState = {
  id: string;
  title: string;
  activeGoal: string | null;
  nextAction: string | null;
  proofNeeded: string | null;
  status: string;
};

export interface CockpitMemoryStore {
  loadSessionState(sessionId?: string): Promise<SessionState | null>;
  loadChatMessages?(sessionId?: string): Promise<ThoughtChatHistoryMessage[]>;
  loadAssistantEvents?(sessionId?: string): Promise<AssistantEvent[]>;
  saveSessionState(args: {
    sessionId?: string;
    message: string;
    output: CockpitAgentOutput;
  }): Promise<{ sessionId?: string; saved: boolean; reason?: string }>;
  saveChatMessage?(args: {
    sessionId?: string;
    role: ThoughtChatRole;
    content: string;
  }): Promise<{ saved: boolean; reason?: string }>;
  appendAssistantEvent?(
    args: AppendAssistantEventInput,
  ): Promise<{ event?: AssistantEvent; saved: boolean; reason?: string }>;
  addParkingLotItem(args: {
    sessionId?: string;
    content: string;
    source?: string;
  }): Promise<{ saved: boolean; reason?: string }>;
  createHandoff(args: {
    sessionId?: string;
    target: string;
    prompt: string;
  }): Promise<{ saved: boolean; reason?: string }>;
}

export const SUPABASE_CLIENT_UNAVAILABLE_REASON =
  "Supabase server client is unavailable.";
export const NO_AUTHENTICATED_USER_REASON =
  "No authenticated Supabase user is present.";

export async function createCockpitMemoryStore(
  supabase: SupabaseClient | null | undefined,
): Promise<CockpitMemoryStore> {
  if (!supabase) {
    return new NullCockpitMemoryStore(SUPABASE_CLIENT_UNAVAILABLE_REASON);
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    const userId = data?.user?.id?.trim();

    if (error || !userId) {
      return new NullCockpitMemoryStore(NO_AUTHENTICATED_USER_REASON);
    }

    return new SupabaseCockpitMemoryStore(supabase, userId);
  } catch {
    return new NullCockpitMemoryStore(NO_AUTHENTICATED_USER_REASON);
  }
}

export class NullCockpitMemoryStore implements CockpitMemoryStore {
  constructor(
    private readonly reason = "Supabase is not configured or no user is authenticated.",
  ) {}

  async loadSessionState(): Promise<SessionState | null> {
    return null;
  }

  async loadChatMessages(): Promise<ThoughtChatHistoryMessage[]> {
    return [];
  }

  async loadAssistantEvents(): Promise<AssistantEvent[]> {
    return [];
  }

  async saveSessionState(): Promise<{
    sessionId?: string;
    saved: boolean;
    reason: string;
  }> {
    return { saved: false, reason: this.reason };
  }

  async saveChatMessage(): Promise<{ saved: boolean; reason: string }> {
    return { saved: false, reason: this.reason };
  }

  async appendAssistantEvent(): Promise<{ saved: boolean; reason: string }> {
    return { saved: false, reason: this.reason };
  }

  async addParkingLotItem(): Promise<{ saved: boolean; reason: string }> {
    return { saved: false, reason: this.reason };
  }

  async createHandoff(): Promise<{ saved: boolean; reason: string }> {
    return { saved: false, reason: this.reason };
  }
}

export class SupabaseCockpitMemoryStore implements CockpitMemoryStore {
  private readonly normalizedUserId: string;

  constructor(
    private readonly supabase: SupabaseClient,
    userId: string,
  ) {
    this.normalizedUserId = userId.trim();
  }

  async loadSessionState(sessionId?: string): Promise<SessionState | null> {
    if (!sessionId || !this.hasAuthenticatedUser()) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("cockpit_sessions")
      .select("id,title,active_goal,next_action,proof_needed,status")
      .eq("id", sessionId)
      .eq("user_id", this.normalizedUserId)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      title: data.title,
      activeGoal: data.active_goal,
      nextAction: data.next_action,
      proofNeeded: data.proof_needed,
      status: data.status,
    };
  }

  async loadChatMessages(sessionId?: string): Promise<ThoughtChatHistoryMessage[]> {
    if (!this.hasAuthenticatedUser()) {
      return [];
    }

    let query = this.supabase
      .from("cockpit_chat_messages")
      .select("role,content,created_at")
      .eq("user_id", this.normalizedUserId)
      .order("created_at", { ascending: false })
      .limit(20);

    query = sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);

    const { data, error } = await query;

    if (error || !data) {
      return [];
    }

    return data
      .slice()
      .reverse()
      .map((message) => ({
        role: message.role as ThoughtChatRole,
        content: message.content,
      }));
  }

  async loadAssistantEvents(sessionId?: string): Promise<AssistantEvent[]> {
    if (!this.hasAuthenticatedUser()) {
      return [];
    }

    let query = this.supabase
      .from("cockpit_assistant_events")
      .select("id,event_type,role,content,metadata,created_at")
      .eq("user_id", this.normalizedUserId)
      .order("created_at", { ascending: false })
      .limit(40);

    query = sessionId ? query.eq("session_id", sessionId) : query.is("session_id", null);

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      return parseAssistantEventRows(data.slice().reverse());
    }

    return assistantEventsFromChatMessages(await this.loadChatMessages(sessionId));
  }

  async saveSessionState({
    sessionId,
    message,
    output,
  }: {
    sessionId?: string;
    message: string;
    output: CockpitAgentOutput;
  }): Promise<{ sessionId?: string; saved: boolean; reason?: string }> {
    if (!this.hasAuthenticatedUser()) {
      return this.unauthenticatedSaveResult();
    }

    const row = {
      user_id: this.normalizedUserId,
      title: createTitle(message, output.currentGoal),
      active_goal: output.currentGoal,
      next_action: output.nextAction,
      proof_needed: output.proofNeeded,
      updated_at: new Date().toISOString(),
    };

    if (sessionId) {
      const { data, error } = await this.supabase
        .from("cockpit_sessions")
        .update(row)
        .eq("id", sessionId)
        .eq("user_id", this.normalizedUserId)
        .select("id")
        .single();

      if (error) {
        return { saved: false, reason: error.message };
      }

      return { sessionId: data.id, saved: true };
    }

    const { data, error } = await this.supabase
      .from("cockpit_sessions")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      return { saved: false, reason: error.message };
    }

    return { sessionId: data.id, saved: true };
  }

  async saveChatMessage({
    sessionId,
    role,
    content,
  }: {
    sessionId?: string;
    role: ThoughtChatRole;
    content: string;
  }): Promise<{ saved: boolean; reason?: string }> {
    if (!this.hasAuthenticatedUser()) {
      return this.unauthenticatedSaveResult();
    }

    const { error } = await this.supabase.from("cockpit_chat_messages").insert({
      user_id: this.normalizedUserId,
      session_id: sessionId ?? null,
      role,
      content,
    });

    return error ? { saved: false, reason: error.message } : { saved: true };
  }

  async appendAssistantEvent({
    sessionId,
    type,
    role,
    content,
    metadata,
  }: AppendAssistantEventInput): Promise<{
    event?: AssistantEvent;
    saved: boolean;
    reason?: string;
  }> {
    if (!this.hasAuthenticatedUser()) {
      return this.unauthenticatedSaveResult();
    }

    const { data, error } = await this.supabase
      .from("cockpit_assistant_events")
      .insert({
        user_id: this.normalizedUserId,
        session_id: sessionId ?? null,
        event_type: type,
        role: role ?? null,
        content,
        metadata: metadata ?? {},
      })
      .select("id,event_type,role,content,metadata,created_at")
      .single();

    if (error) {
      return { saved: false, reason: error.message };
    }

    return {
      event: parseAssistantEventRows([data])[0],
      saved: true,
    };
  }

  async addParkingLotItem({
    sessionId,
    content,
    source,
  }: {
    sessionId?: string;
    content: string;
    source?: string;
  }): Promise<{ saved: boolean; reason?: string }> {
    if (!this.hasAuthenticatedUser()) {
      return this.unauthenticatedSaveResult();
    }

    const { error } = await this.supabase.from("parking_lot_items").insert({
      user_id: this.normalizedUserId,
      session_id: sessionId ?? null,
      content,
      source: source ?? null,
    });

    return error ? { saved: false, reason: error.message } : { saved: true };
  }

  async createHandoff({
    sessionId,
    target,
    prompt,
  }: {
    sessionId?: string;
    target: string;
    prompt: string;
  }): Promise<{ saved: boolean; reason?: string }> {
    if (!this.hasAuthenticatedUser()) {
      return this.unauthenticatedSaveResult();
    }

    const { error } = await this.supabase.from("handoffs").insert({
      user_id: this.normalizedUserId,
      session_id: sessionId ?? null,
      target,
      prompt,
    });

    return error ? { saved: false, reason: error.message } : { saved: true };
  }

  private hasAuthenticatedUser(): boolean {
    return this.normalizedUserId.length > 0;
  }

  private unauthenticatedSaveResult(): { saved: false; reason: string } {
    return { saved: false, reason: NO_AUTHENTICATED_USER_REASON };
  }
}

function createTitle(message: string, fallback: string): string {
  const title = message.replace(/\s+/g, " ").trim() || fallback;
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}
