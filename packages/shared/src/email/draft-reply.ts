/**
 * Email Draft Reply
 *
 * Generates reply drafts for emails based on category and intent.
 * Used by the email_draftReply MCP tool and ClaudeGolem chat.
 */

/** Input for generating a reply draft */
export interface ReplyDraftInput {
  originalSubject: string;
  originalFrom: string;
  originalSnippet: string;
  category: string;
  intent: "accept" | "decline" | "interested" | "followup" | "acknowledge";
  customNote?: string;
}

/** Generated reply draft ready for review */
export interface ReplyDraft {
  subject: string;
  to: string;
  body: string;
  intent: string;
  status: "draft";
  createdAt: string;
}

// Template bodies by category + intent
const TEMPLATES: Record<string, Record<string, string>> = {
  interview: {
    accept: "Thank you for the interview opportunity. I'm available and looking forward to discussing the role further. Please let me know the next steps.",
    decline: "Thank you for considering me. After careful thought, I've decided to pursue other opportunities at this time. I appreciate your time.",
    followup: "I wanted to follow up on the interview we discussed. I'm still very interested in the opportunity. Please let me know if there are any updates.",
    acknowledge: "Thank you for reaching out about the interview. I'll review the details and get back to you shortly.",
  },
  job: {
    interested: "Thank you for reaching out about this opportunity. I'm interested and would love to learn more. When would be a good time to connect?",
    decline: "Thank you for thinking of me. At this time, I'm focused on other opportunities, but I appreciate you reaching out.",
    followup: "I wanted to follow up on my application. I remain very interested in the role and would appreciate any updates on the process.",
    acknowledge: "Thank you for the update on my application. I appreciate being kept in the loop.",
  },
  urgent: {
    acknowledge: "Thank you for flagging this. I'll look into it right away and follow up shortly.",
    followup: "Following up on the urgent matter. Could you provide any additional details or updates?",
  },
  default: {
    acknowledge: "Thank you for your email. I've received it and will respond in detail shortly.",
    followup: "Following up on your previous email. Please let me know if there's anything else you need.",
  },
};

/**
 * Build a reply draft based on the input email and intent.
 */
export function buildReplyDraft(input: ReplyDraftInput): ReplyDraft {
  const { originalSubject, originalFrom, category, intent, customNote } = input;

  // Build subject with Re: prefix (case-insensitive, avoid double-prefix)
  const subject = /^re:\s*/i.test(originalSubject)
    ? originalSubject
    : `Re: ${originalSubject}`;

  // Get template body
  const categoryTemplates = TEMPLATES[category] || TEMPLATES.default;
  const templateBody = categoryTemplates[intent] || TEMPLATES.default.acknowledge;

  // Build body with optional custom note
  let body = templateBody;
  if (customNote) {
    body = `${customNote}\n\n${body}`;
  }

  return {
    subject,
    to: originalFrom,
    body,
    intent,
    status: "draft",
    createdAt: new Date().toISOString(),
  };
}
