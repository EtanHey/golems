/**
 * WhatsApp .txt export parser
 *
 * Parses WhatsApp text exports into structured messages for indexing in Zikaron.
 * Handles both 12h and 24h time formats, multiline messages, and media attachments.
 */

export interface ChatMessage {
  timestamp: Date;
  sender: string;
  content: string;
  isMedia: boolean;
}

/**
 * Parse WhatsApp .txt export file
 *
 * Format examples:
 * - 12h: "1/15/24, 3:45 PM - John Doe: Message text"
 * - 24h: "15/01/2024, 15:45 - John Doe: Message text"
 * - Media: "1/15/24, 3:45 PM - John Doe: <Media omitted>"
 * - Multiline: Lines without timestamp prefix are continuations
 */
export function parseWhatsAppExport(filePath: string): ChatMessage[] {
  const fs = require('fs');
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const messages: ChatMessage[] = [];
  let currentMessage: ChatMessage | null = null;

  // Regex patterns for WhatsApp export formats
  // Matches: "1/15/24, 3:45 PM - John Doe: " or "15/01/2024, 15:45 - John Doe: "
  const messagePattern = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\s*[-–]\s*([^:]+):\s*(.*)$/i;

  for (const line of lines) {
    const match = line.match(messagePattern);

    if (match) {
      // Save previous message if exists
      if (currentMessage && (currentMessage.content.trim() || currentMessage.isMedia)) {
        messages.push(currentMessage);
      }

      const [, datePart, timePart, sender, content] = match;
      const timestamp = parseWhatsAppTimestamp(datePart, timePart);
      const isMedia = content.trim() === '<Media omitted>' ||
                      content.includes('image omitted') ||
                      content.includes('video omitted') ||
                      content.includes('audio omitted') ||
                      content.includes('document omitted');

      currentMessage = {
        timestamp,
        sender: sender.trim(),
        content: isMedia ? '' : content.trim(),
        isMedia
      };
    } else if (currentMessage && line.trim()) {
      // Multiline message continuation
      currentMessage.content += '\n' + line;
    }
  }

  // Don't forget the last message
  if (currentMessage && (currentMessage.content.trim() || currentMessage.isMedia)) {
    messages.push(currentMessage);
  }

  return messages;
}

/**
 * Parse WhatsApp timestamp from date and time parts
 * Handles both 12h (AM/PM) and 24h formats
 */
function parseWhatsAppTimestamp(datePart: string, timePart: string): Date {
  // Parse date: "1/15/24" or "15/01/2024"
  const dateParts = datePart.split('/');
  let month: number, day: number, year: number;

  if (dateParts[2].length === 2) {
    // Assume MM/DD/YY format (US)
    month = parseInt(dateParts[0], 10);
    day = parseInt(dateParts[1], 10);
    year = 2000 + parseInt(dateParts[2], 10);
  } else {
    // Assume DD/MM/YYYY format (international)
    day = parseInt(dateParts[0], 10);
    month = parseInt(dateParts[1], 10);
    year = parseInt(dateParts[2], 10);
  }

  // Parse time: "3:45 PM" or "15:45" or "15:45:30"
  const timeUpper = timePart.trim().toUpperCase();
  const isPM = timeUpper.includes('PM');
  const isAM = timeUpper.includes('AM');
  const cleanTime = timeUpper.replace(/AM|PM/g, '').trim();
  const timeParts = cleanTime.split(':');

  let hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = timeParts[2] ? parseInt(timeParts[2], 10) : 0;

  // Convert 12h to 24h
  if (isAM && hours === 12) {
    hours = 0;
  } else if (isPM && hours !== 12) {
    hours += 12;
  }

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Group consecutive messages from same sender within time window
 * This reduces chunk count and improves semantic coherence
 */
export function groupMessages(messages: ChatMessage[], maxGapMinutes: number = 5): ChatMessage[] {
  if (messages.length === 0) return [];

  const grouped: ChatMessage[] = [];
  let currentGroup = messages[0];

  for (let i = 1; i < messages.length; i++) {
    const msg = messages[i];
    const timeDiffMs = msg.timestamp.getTime() - currentGroup.timestamp.getTime();
    const timeDiffMin = timeDiffMs / (1000 * 60);

    // Same sender and within time window?
    if (msg.sender === currentGroup.sender && timeDiffMin <= maxGapMinutes) {
      // Merge into current group
      currentGroup.content += '\n\n' + msg.content;
      // Keep earliest timestamp
    } else {
      // Save current group and start new one
      grouped.push(currentGroup);
      currentGroup = msg;
    }
  }

  // Don't forget the last group
  grouped.push(currentGroup);

  return grouped;
}
