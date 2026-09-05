import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import {
  createDbClient,
  safeInsert,
  syncOfflineQueue,
  getSubscriptionSummary,
  getRecentEmails,
  loadLocalQueue,
  clearLocalQueue,
  OFFLINE_QUEUE_PATH
} from '@golems/shared/email/db-client';
import type { Email, Subscription, Payment } from '@golems/shared/email/types';
import { existsSync, unlinkSync, writeFileSync } from 'fs';

// Test fixtures
const mockEmail: Email = {
  gmail_id: 'test-123',
  subject: 'Test Email',
  from_address: 'test@example.com',
  snippet: 'Test snippet',
  score: 7,
  category: 'job',
  received_at: new Date('2026-02-01'),
  notified: false
};

const mockSubscription: Subscription = {
  service_name: 'Netflix',
  amount: 15.99,
  currency: 'USD',
  frequency: 'monthly',
  status: 'active'
};

const mockPayment: Payment = {
  subscription_id: null,
  email_id: null,
  amount: 15.99,
  currency: 'USD',
  paid_at: new Date('2026-02-01')
};

describe('db-client', () => {
  beforeEach(() => {
    // Clear offline queue before each test
    if (existsSync(OFFLINE_QUEUE_PATH)) {
      unlinkSync(OFFLINE_QUEUE_PATH);
    }
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(OFFLINE_QUEUE_PATH)) {
      unlinkSync(OFFLINE_QUEUE_PATH);
    }
  });

  describe('createDbClient', () => {
    it('creates client with env credentials', () => {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
        // No env vars — verify it throws the expected error
        expect(() => createDbClient()).toThrow('Missing SUPABASE_URL');
        return;
      }
      const client = createDbClient();
      expect(client).toBeDefined();
    });

    it('creates client with custom credentials', () => {
      const client = createDbClient({
        url: 'https://test.supabase.co',
        key: 'test-key'
      });
      expect(client).toBeDefined();
    });
  });

  describe('safeInsert - offline resilience', () => {
    it('queues data when insert fails (offline mode)', async () => {
      // Create a mock client that always fails
      const mockClient = {
        from: () => ({
          insert: () => Promise.resolve({ error: { message: 'Network error' } })
        })
      };

      const result = await safeInsert(mockClient as any, 'emails', mockEmail);

      expect(result.success).toBe(false);
      expect(result.queued).toBe(true);

      // Verify data was queued
      const queue = loadLocalQueue();
      expect(queue.length).toBe(1);
      expect(queue[0].table).toBe('emails');
      expect(queue[0].data.gmail_id).toBe('test-123');
    });

    it('returns success when insert succeeds', async () => {
      const mockClient = {
        from: () => ({
          insert: () => Promise.resolve({ error: null, data: [{ id: 'new-id' }] })
        })
      };

      const result = await safeInsert(mockClient as any, 'emails', mockEmail);

      expect(result.success).toBe(true);
      expect(result.queued).toBeUndefined();
    });

    it('handles network timeout gracefully', async () => {
      const mockClient = {
        from: () => ({
          insert: () => Promise.reject(new Error('ETIMEDOUT'))
        })
      };

      const result = await safeInsert(mockClient as any, 'emails', mockEmail);

      expect(result.success).toBe(false);
      expect(result.queued).toBe(true);
    });
  });

  describe('syncOfflineQueue', () => {
    it('syncs queued items when back online', async () => {
      // Pre-populate queue
      const queuedItem = {
        id: 'queue-1',
        table: 'emails',
        data: mockEmail,
        timestamp: new Date()
      };
      writeFileSync(OFFLINE_QUEUE_PATH, JSON.stringify([queuedItem]));

      let insertCalled = false;
      const mockClient = {
        from: () => ({
          insert: () => {
            insertCalled = true;
            return Promise.resolve({ error: null });
          }
        })
      };

      const result = await syncOfflineQueue(mockClient as any);

      expect(insertCalled).toBe(true);
      expect(result.synced).toBeGreaterThan(0);

      // Queue should be empty after sync
      const queue = loadLocalQueue();
      expect(queue.length).toBe(0);
    });

    it('keeps items in queue if sync fails', async () => {
      // Pre-populate queue
      const queuedItem = {
        id: 'queue-1',
        table: 'emails',
        data: mockEmail,
        timestamp: new Date()
      };
      writeFileSync(OFFLINE_QUEUE_PATH, JSON.stringify([queuedItem]));

      const mockClient = {
        from: () => ({
          insert: () => Promise.resolve({ error: { message: 'Still offline' } })
        })
      };

      const result = await syncOfflineQueue(mockClient as any);

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(1);

      // Queue should still have item
      const queue = loadLocalQueue();
      expect(queue.length).toBe(1);
    });

    it('handles empty queue gracefully', async () => {
      const mockClient = {
        from: () => ({
          insert: () => Promise.resolve({ error: null })
        })
      };

      const result = await syncOfflineQueue(mockClient as any);

      expect(result.synced).toBe(0);
      expect(result.failed).toBe(0);
    });
  });

  describe('getSubscriptionSummary', () => {
    it('returns subscription summary for monthly report', async () => {
      const mockClient = {
        from: (table: string) => ({
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { service_name: 'Netflix', amount: 15.99, currency: 'USD', status: 'active', frequency: 'monthly' },
                { service_name: 'Spotify', amount: 10.99, currency: 'USD', status: 'active', frequency: 'monthly' }
              ],
              error: null
            })
          })
        })
      };

      const summary = await getSubscriptionSummary(mockClient as any);

      expect(summary.totalMonthly).toBeCloseTo(26.98, 2);
      expect(summary.services.length).toBe(2);
      expect(summary.services[0].name).toBe('Netflix');
    });

    it('handles yearly subscriptions in monthly calculation', async () => {
      const mockClient = {
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({
              data: [
                { service_name: 'iCloud', amount: 12.00, currency: 'USD', status: 'active', frequency: 'yearly' }
              ],
              error: null
            })
          })
        })
      };

      const summary = await getSubscriptionSummary(mockClient as any);

      // Yearly $12 = $1/month
      expect(summary.totalMonthly).toBeCloseTo(1.0, 2);
    });

    it('returns empty summary on error', async () => {
      const mockClient = {
        from: () => ({
          select: () => ({
            eq: () => Promise.resolve({
              data: null,
              error: { message: 'Network error' }
            })
          })
        })
      };

      const summary = await getSubscriptionSummary(mockClient as any);

      expect(summary.totalMonthly).toBe(0);
      expect(summary.services.length).toBe(0);
    });
  });

  describe('getRecentEmails', () => {
    it('returns emails from last 24 hours for briefing', async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const mockClient = {
        from: () => ({
          select: () => ({
            gte: () => ({
              order: () => Promise.resolve({
                data: [
                  { ...mockEmail, id: '1', score: 10, category: 'interview' },
                  { ...mockEmail, id: '2', score: 7, category: 'job' }
                ],
                error: null
              })
            })
          })
        })
      };

      const emails = await getRecentEmails(mockClient as any, 24);

      expect(emails.length).toBe(2);
      expect(emails[0].score).toBe(10);
    });

    it('filters by minimum score', async () => {
      const mockClient = {
        from: () => ({
          select: () => ({
            gte: (col: string, val: any) => ({
              gte: (col2: string, val2: number) => ({
                order: () => Promise.resolve({
                  data: [
                    { ...mockEmail, id: '1', score: 7 }
                  ],
                  error: null
                })
              }),
              order: () => Promise.resolve({
                data: [
                  { ...mockEmail, id: '1', score: 7 },
                  { ...mockEmail, id: '2', score: 5 }
                ],
                error: null
              })
            })
          })
        })
      };

      const emails = await getRecentEmails(mockClient as any, 24, 5);

      expect(emails.length).toBeGreaterThan(0);
    });

    it('returns empty array on error', async () => {
      const mockClient = {
        from: () => ({
          select: () => ({
            gte: () => ({
              order: () => Promise.resolve({
                data: null,
                error: { message: 'Network error' }
              })
            })
          })
        })
      };

      const emails = await getRecentEmails(mockClient as any, 24);

      expect(emails).toEqual([]);
    });
  });
});
