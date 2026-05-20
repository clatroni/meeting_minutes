export interface Participant {
  name: string;
  role?: string;
  organization?: string;
}

export interface MeetingInfo {
  title: string;
  date: string;
  duration?: string;
  project_name?: string;
  client_name?: string;
  objective?: string;
  language?: string;
  participants: Participant[];
}

export interface DiscussionTopic {
  title: string;
  summary: string;
}

export interface Decision {
  decision: string;
  rationale?: string;
  owner?: string;
}

export interface ActionItem {
  action: string;
  owner: string;
  due_date: string;
  priority: "High" | "Medium" | "Low";
  status: "Not Started" | "In Progress" | "Completed";
}

export interface Risk {
  type: "Risk" | "Issue";
  description: string;
  impact: "High" | "Medium" | "Low";
  owner?: string;
}

export interface TimelineEntry {
  milestone: string;
  date: string;
}

export interface MoM {
  meeting_info: MeetingInfo;
  executive_summary: string;
  discussion_topics: DiscussionTopic[];
  decisions_log: Decision[];
  action_items: ActionItem[];
  risks_issues?: Risk[];
  timeline?: TimelineEntry[];
  open_questions?: string[];
}
