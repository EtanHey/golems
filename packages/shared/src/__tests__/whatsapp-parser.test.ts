import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { parseWhatsAppExport, groupMessages, type ChatMessage } from '@golems/shared/lib/whatsapp-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('WhatsApp Parser', () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-test-'));
    testFile = path.join(tempDir, 'chat.txt');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('parseWhatsAppExport', () => {
    test('parses basic 12h format message', () => {
      const content = '1/15/24, 3:45 PM - John Doe: Hello world';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages).toHaveLength(1);
      expect(messages[0].sender).toBe('John Doe');
      expect(messages[0].content).toBe('Hello world');
      expect(messages[0].isMedia).toBe(false);
      expect(messages[0].timestamp.getFullYear()).toBe(2024);
      expect(messages[0].timestamp.getMonth()).toBe(0); // January = 0
      expect(messages[0].timestamp.getDate()).toBe(15);
      expect(messages[0].timestamp.getHours()).toBe(15); // 3 PM = 15
      expect(messages[0].timestamp.getMinutes()).toBe(45);
    });

    test('parses 24h format message', () => {
      const content = '15/01/2024, 15:45 - John Doe: Hello world';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages).toHaveLength(1);
      expect(messages[0].sender).toBe('John Doe');
      expect(messages[0].timestamp.getHours()).toBe(15);
    });

    test('parses AM time correctly (12 AM = midnight)', () => {
      const content = '1/15/24, 12:30 AM - Alice: Midnight message';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].timestamp.getHours()).toBe(0); // 12 AM = 0
      expect(messages[0].timestamp.getMinutes()).toBe(30);
    });

    test('parses PM time correctly (12 PM = noon)', () => {
      const content = '1/15/24, 12:30 PM - Bob: Noon message';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].timestamp.getHours()).toBe(12); // 12 PM = 12
    });

    test('detects media omitted messages', () => {
      const content = '1/15/24, 3:45 PM - John Doe: <Media omitted>';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].isMedia).toBe(true);
      expect(messages[0].content).toBe('');
    });

    test('handles multiline messages', () => {
      const content = `1/15/24, 3:45 PM - John Doe: First line
Second line
Third line
1/15/24, 3:50 PM - Alice: Next message`;
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toContain('First line\nSecond line\nThird line');
      expect(messages[1].sender).toBe('Alice');
    });

    test('handles multiple messages from different senders', () => {
      const content = `1/15/24, 3:45 PM - John: Hi
1/15/24, 3:46 PM - Alice: Hello
1/15/24, 3:47 PM - Bob: Hey`;
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages).toHaveLength(3);
      expect(messages[0].sender).toBe('John');
      expect(messages[1].sender).toBe('Alice');
      expect(messages[2].sender).toBe('Bob');
    });

    test('handles empty lines', () => {
      const content = `1/15/24, 3:45 PM - John: Message one

1/15/24, 3:46 PM - Alice: Message two`;
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Message one');
      expect(messages[1].content).toBe('Message two');
    });

    test('handles messages with colons in content', () => {
      const content = '1/15/24, 3:45 PM - John: Check this link: https://example.com';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].content).toBe('Check this link: https://example.com');
    });

    test('handles sender names with special characters', () => {
      const content = '1/15/24, 3:45 PM - John O\'Brien: Hello';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].sender).toBe('John O\'Brien');
    });

    test('handles time with seconds', () => {
      const content = '15/01/2024, 15:45:30 - John: Message with seconds';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].timestamp.getSeconds()).toBe(30);
    });

    test('ignores system messages (no sender)', () => {
      const content = `1/15/24, 3:45 PM - John: Real message
1/15/24, 3:46 PM - Messages and calls are end-to-end encrypted
1/15/24, 3:47 PM - Alice: Another real message`;
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      // System message should be skipped (no colon separator)
      expect(messages).toHaveLength(2);
      expect(messages[0].sender).toBe('John');
      expect(messages[1].sender).toBe('Alice');
    });

    test('handles en dash separator (–)', () => {
      const content = '1/15/24, 3:45 PM – John Doe: Message with en dash';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages).toHaveLength(1);
      expect(messages[0].sender).toBe('John Doe');
    });

    test('handles 2-digit year format', () => {
      const content = '1/15/24, 3:45 PM - John: Message in 2024';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].timestamp.getFullYear()).toBe(2024);
    });

    test('handles 4-digit year format', () => {
      const content = '15/01/2024, 15:45 - John: Message in 2024';
      fs.writeFileSync(testFile, content);

      const messages = parseWhatsAppExport(testFile);

      expect(messages[0].timestamp.getFullYear()).toBe(2024);
    });
  });

  describe('groupMessages', () => {
    test('groups consecutive messages from same sender within time window', () => {
      const messages: ChatMessage[] = [
        {
          timestamp: new Date('2024-01-15T15:00:00'),
          sender: 'John',
          content: 'First message',
          isMedia: false
        },
        {
          timestamp: new Date('2024-01-15T15:02:00'), // 2 min later
          sender: 'John',
          content: 'Second message',
          isMedia: false
        },
        {
          timestamp: new Date('2024-01-15T15:03:00'), // 1 min later
          sender: 'John',
          content: 'Third message',
          isMedia: false
        }
      ];

      const grouped = groupMessages(messages, 5);

      expect(grouped).toHaveLength(1);
      expect(grouped[0].content).toContain('First message');
      expect(grouped[0].content).toContain('Second message');
      expect(grouped[0].content).toContain('Third message');
      expect(grouped[0].timestamp).toEqual(messages[0].timestamp); // Keeps earliest
    });

    test('does not group messages from different senders', () => {
      const messages: ChatMessage[] = [
        {
          timestamp: new Date('2024-01-15T15:00:00'),
          sender: 'John',
          content: 'From John',
          isMedia: false
        },
        {
          timestamp: new Date('2024-01-15T15:01:00'),
          sender: 'Alice',
          content: 'From Alice',
          isMedia: false
        }
      ];

      const grouped = groupMessages(messages, 5);

      expect(grouped).toHaveLength(2);
      expect(grouped[0].sender).toBe('John');
      expect(grouped[1].sender).toBe('Alice');
    });

    test('does not group messages beyond time window', () => {
      const messages: ChatMessage[] = [
        {
          timestamp: new Date('2024-01-15T15:00:00'),
          sender: 'John',
          content: 'First',
          isMedia: false
        },
        {
          timestamp: new Date('2024-01-15T15:06:00'), // 6 min later (> 5 min)
          sender: 'John',
          content: 'Second',
          isMedia: false
        }
      ];

      const grouped = groupMessages(messages, 5);

      expect(grouped).toHaveLength(2);
    });

    test('handles empty array', () => {
      const grouped = groupMessages([]);
      expect(grouped).toHaveLength(0);
    });

    test('handles single message', () => {
      const messages: ChatMessage[] = [
        {
          timestamp: new Date('2024-01-15T15:00:00'),
          sender: 'John',
          content: 'Only message',
          isMedia: false
        }
      ];

      const grouped = groupMessages(messages);
      expect(grouped).toHaveLength(1);
      expect(grouped[0].content).toBe('Only message');
    });

    test('custom time window works', () => {
      const messages: ChatMessage[] = [
        {
          timestamp: new Date('2024-01-15T15:00:00'),
          sender: 'John',
          content: 'First',
          isMedia: false
        },
        {
          timestamp: new Date('2024-01-15T15:08:00'), // 8 min later
          sender: 'John',
          content: 'Second',
          isMedia: false
        }
      ];

      const grouped5 = groupMessages(messages, 5);
      expect(grouped5).toHaveLength(2); // Separated with 5min window

      const grouped10 = groupMessages(messages, 10);
      expect(grouped10).toHaveLength(1); // Grouped with 10min window
    });

    test('merges content with double newlines', () => {
      const messages: ChatMessage[] = [
        {
          timestamp: new Date('2024-01-15T15:00:00'),
          sender: 'John',
          content: 'Part one',
          isMedia: false
        },
        {
          timestamp: new Date('2024-01-15T15:01:00'),
          sender: 'John',
          content: 'Part two',
          isMedia: false
        }
      ];

      const grouped = groupMessages(messages, 5);

      expect(grouped[0].content).toBe('Part one\n\nPart two');
    });
  });
});
