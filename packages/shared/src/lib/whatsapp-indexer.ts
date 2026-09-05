/**
 * WhatsApp Indexer - Send WhatsApp chats to BrainLayer for semantic search
 *
 * Converts WhatsApp exports to JSONL format and indexes them using
 * BrainLayer's CLI (brainlayer index-fast).
 */

import { parseWhatsAppExport, groupMessages } from './whatsapp-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

/**
 * Index WhatsApp chat export in BrainLayer
 *
 * @param exportPath - Path to WhatsApp .txt export file
 * @param chatName - Display name for the chat (e.g., "Family Group", "John Doe")
 * @param options - Optional configuration
 */
export async function indexWhatsAppChat(
  exportPath: string,
  chatName: string,
  options: {
    groupGapMinutes?: number;
  } = {}
): Promise<void> {
  const { groupGapMinutes = 5 } = options;

  console.log(`Parsing WhatsApp export: ${exportPath}`);
  const messages = parseWhatsAppExport(exportPath);
  console.log(`Found ${messages.length} messages`);

  console.log(`Grouping messages (${groupGapMinutes}min window)...`);
  const grouped = groupMessages(messages, groupGapMinutes);
  console.log(`Grouped into ${grouped.length} chunks`);

  // Filter out media-only messages
  const textMessages = grouped.filter(msg => !msg.isMedia && msg.content.trim());
  console.log(`${textMessages.length} text messages to index`);

  // Create temporary JSONL file for Zikaron
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-index-'));
  const jsonlPath = path.join(tempDir, 'whatsapp-messages.jsonl');

  try {
    // Convert to JSONL format (similar to Claude Code conversation format)
    const jsonlLines = textMessages.map(msg => {
      const entry = {
        type: 'whatsapp_message',
        timestamp: msg.timestamp.toISOString(),
        sender: msg.sender,
        content: msg.content,
        metadata: {
          source: 'whatsapp',
          chat: chatName,
          sender: msg.sender,
          content_type: 'whatsapp_message',
          value_type: 'high'
        }
      };
      return JSON.stringify(entry);
    });

    fs.writeFileSync(jsonlPath, jsonlLines.join('\n'));
    console.log(`Created JSONL file: ${jsonlPath}`);

    // Call BrainLayer CLI to index
    console.log('Indexing with BrainLayer...');
    const brainlayerPath = findBrainLayerCli();

    if (!brainlayerPath) {
      throw new Error('BrainLayer CLI not found. Install: pip install git+https://github.com/EtanHey/brainlayer.git');
    }

    const result = spawnSync(
      brainlayerPath,
      ['index-fast', jsonlPath, '--project', `whatsapp-${sanitizeChatName(chatName)}`],
      { stdio: 'inherit' }
    );

    if (result.status !== 0) {
      throw new Error(`BrainLayer indexing failed with exit code ${result.status}`);
    }

    console.log(`✓ Indexed ${textMessages.length} messages from "${chatName}"`);
  } finally {
    // Clean up temp file
    fs.rmSync(tempDir, { recursive: true });
  }
}

/**
 * Find BrainLayer CLI executable
 */
function findBrainLayerCli(): string | null {
  // Try common paths
  const paths = [
    // System-wide installation
    '/usr/local/bin/brainlayer',
    `${process.env.HOME}/.local/bin/brainlayer`
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Try PATH
  const which = spawnSync('which', ['brainlayer'], { encoding: 'utf-8' });
  if (which.status === 0 && which.stdout.trim()) {
    return which.stdout.trim();
  }

  return null;
}

/**
 * Sanitize chat name for use as project name
 */
function sanitizeChatName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
