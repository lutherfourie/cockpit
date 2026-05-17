import type { SupabaseClient } from "@supabase/supabase-js";

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

  async addParkingLotItem(): Promise<{ saved: boolean; reason: string }> {
    return { saved: false, reason: this.reason };
  }

  async createHandoff(): Promise<{ saved: boolean; reason: string }> {
    return { saved: false, reason: this.reason };
  }
}

export class SupabaseCockpitMemoryStore implements CockpitMemoryStore {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly userId: string,
  ) {}

  async loadSessionState(sessionId?: string): Promise<SessionState | null> {
    if (!sessionId) {
      return null;
    }

    const { data, error } = await this.supabase
      .from("cockpit_sessions")
      .select("id,title,active_goal,next_action,proof_needed,status")
      .eq("id", sessionId)
      .eq("user_id", this.userId)
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
    let query = this.supabase
      .from("cockpit_chat_messages")
      .select("role,content,created_at")
      .eq("user_id", this.userId)
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

  async saveSessionState({
    sessionId,
    message,
    output,
  }: {
    sessionId?: string;
    message: string;
    output: CockpitAgentOutput;
  }): Promise<{ sessionId?: string; saved: boolean; reason?: string }> {
    const row = {
      user_id: this.userId,
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
        .eq("user_id", this.userId)
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
    const { error } = await this.supabase.from("cockpit_chat_messages").insert({
      user_id: this.userId,
      session_id: sessionId ?? null,
      role,
      content,
    });

    return error ? { saved: false, reason: error.message } : { saved: true };
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
    const { error } = await this.supabase.from("parking_lot_items").insert({
      user_id: this.userId,
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
    const { error } = await this.supabase.from("handoffs").insert({
      user_id: this.userId,
      session_id: sessionId ?? null,
      target,
      prompt,
    });

    return error ? { saved: false, reason: error.message } : { saved: true };
  }
}

function createTitle(message: string, fallback: string): string {
  const title = message.replace(/\s+/g, " ").trim() || fallback;
  return title.length > 72 ? `${title.slice(0, 69)}...` : title;
}
