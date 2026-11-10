/** One saved conversation with the assistant. Messages are kept as shown. */
export interface AssistantConversation {
  id: string;
  teacher_id: string;
  title: string;
  messages: unknown[];
  created_at: string;
  updated_at: string;
}
