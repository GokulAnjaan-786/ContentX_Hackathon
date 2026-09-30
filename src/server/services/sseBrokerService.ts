import crypto from 'crypto';
import { GenerationProgressEvent, UserRole } from '../../types/contentx.ts';
import { logger } from '../utils/logger.ts';
import { metricsRegistry } from './metricsService.ts';

type EventListener = (event: GenerationProgressEvent) => void;

export interface SseTicket {
  ticket: string;
  jobId: string;
  userEmail: string;
  userRole: UserRole;
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
}

class SseBrokerService {
  private subscribers = new Map<string, Set<EventListener>>();
  private lastEvents = new Map<string, GenerationProgressEvent>();
  private eventSequenceMap = new Map<string, number>();
  private tickets = new Map<string, SseTicket>();
  private totalConnectionsCount = 0;

  /**
   * Subscribe a client listener to live generation progress events for a specific jobId.
   * Returns an unsubscribe function for convenient cleanup.
   */
  public subscribe(jobId: string, listener: EventListener): () => void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, new Set());
    }
    this.subscribers.get(jobId)!.add(listener);

    this.totalConnectionsCount++;
    metricsRegistry.sseConnectionsTotal.inc();
    this.updateActiveConnectionsMetric();

    return () => {
      this.unsubscribe(jobId, listener);
    };
  }

  /**
   * Unsubscribe a client listener from a specific jobId.
   */
  public unsubscribe(jobId: string, listener: EventListener): void {
    const jobSubscribers = this.subscribers.get(jobId);
    if (jobSubscribers) {
      jobSubscribers.delete(listener);
      if (jobSubscribers.size === 0) {
        this.subscribers.delete(jobId);
      }
    }
    this.updateActiveConnectionsMetric();
  }

  /**
   * Publish a progress event to all active SSE subscribers for a jobId.
   * Non-blocking, isolated transient delivery. Safe if no subscribers exist.
   */
  public publish(
    jobId: string,
    eventPartial: Omit<GenerationProgressEvent, 'eventId' | 'timestamp'> & {
      eventId?: string;
      timestamp?: string;
    }
  ): GenerationProgressEvent {
    const nextSeq = (this.eventSequenceMap.get(jobId) || 0) + 1;
    this.eventSequenceMap.set(jobId, nextSeq);

    const fullEvent: GenerationProgressEvent = {
      ...eventPartial,
      eventId: eventPartial.eventId || `evt_${jobId}_${nextSeq}`,
      timestamp: eventPartial.timestamp || new Date().toISOString(),
    };

    // Store in memory for immediate state replay on new connection or reconnect
    this.lastEvents.set(jobId, fullEvent);
    metricsRegistry.sseEventsTotal.inc();

    const jobSubscribers = this.subscribers.get(jobId);
    if (jobSubscribers && jobSubscribers.size > 0) {
      for (const listener of Array.from(jobSubscribers)) {
        try {
          listener(fullEvent);
        } catch (err) {
          logger.warn(`[SSE BROKER] Exception in listener for job ${jobId}`, {
            event: 'sse_listener_error',
            jobId,
            error: String(err),
          });
        }
      }
    }

    return fullEvent;
  }

  /**
   * Get the last emitted progress event for a job (used for initial connection state).
   */
  public getLastEvent(jobId: string): GenerationProgressEvent | null {
    return this.lastEvents.get(jobId) || null;
  }

  /**
   * Generate a short-lived single-use ticket for SSE EventSource connections.
   */
  public createTicket(
    jobId: string,
    userEmail: string,
    userRole: UserRole,
    ttlSeconds = 30
  ): SseTicket {
    this.cleanExpiredTickets();
    const ticketId = `tkt_${crypto.randomBytes(24).toString('hex')}`;
    const now = Date.now();
    const ticket: SseTicket = {
      ticket: ticketId,
      jobId,
      userEmail,
      userRole,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000,
      consumed: false,
    };
    this.tickets.set(ticketId, ticket);
    return ticket;
  }

  /**
   * Consume and validate a short-lived SSE ticket.
   * Single-use: once consumed, the ticket cannot be reused.
   */
  public consumeTicket(
    ticketId: string,
    targetJobId: string
  ): { valid: boolean; ticket?: SseTicket; reason?: string } {
    this.cleanExpiredTickets();
    if (!ticketId || typeof ticketId !== 'string') {
      return { valid: false, reason: 'Ticket parameter is missing.' };
    }

    const tkt = this.tickets.get(ticketId);
    if (!tkt) {
      return { valid: false, reason: 'Invalid or unknown SSE ticket.' };
    }

    if (tkt.consumed) {
      return { valid: false, reason: 'SSE ticket has already been consumed.' };
    }

    if (Date.now() > tkt.expiresAt) {
      this.tickets.delete(ticketId);
      return { valid: false, reason: 'SSE ticket has expired.' };
    }

    if (tkt.jobId !== targetJobId) {
      return {
        valid: false,
        reason: 'SSE ticket is bound to a different generation job.',
      };
    }

    // Mark as consumed (single-use enforcement)
    tkt.consumed = true;
    return { valid: true, ticket: tkt };
  }

  /**
   * Remove expired tickets to prevent memory growth.
   */
  private cleanExpiredTickets(): void {
    const now = Date.now();
    for (const [id, t] of Array.from(this.tickets.entries())) {
      if (now > t.expiresAt) {
        this.tickets.delete(id);
      }
    }
  }

  /**
   * Clean up in-memory broker state for a job when terminal state is reached or after TTL.
   */
  public cleanup(jobId: string): void {
    this.subscribers.delete(jobId);
    this.lastEvents.delete(jobId);
    this.eventSequenceMap.delete(jobId);
    this.updateActiveConnectionsMetric();
  }

  /**
   * Get current active subscriber count for telemetry/debugging.
   */
  public getSubscriberCount(jobId: string): number {
    return this.subscribers.get(jobId)?.size || 0;
  }

  /**
   * Get total active subscribers across all jobs.
   */
  public getTotalActiveSubscribers(): number {
    let total = 0;
    for (const set of this.subscribers.values()) {
      total += set.size;
    }
    return total;
  }

  /**
   * Update Prometheus SSE Active Connections Gauge.
   */
  private updateActiveConnectionsMetric(): void {
    metricsRegistry.sseActiveConnections.set(this.getTotalActiveSubscribers());
  }

  /**
   * Graceful shutdown connection cleanup.
   * Prevents memory leaks and safely clears subscriber listeners.
   */
  public closeAllConnections(): void {
    logger.info('Closing all active SSE connections for graceful shutdown', {
      event: 'sse_shutdown_cleanup',
      activeConnections: this.getTotalActiveSubscribers(),
    });
    this.subscribers.clear();
    this.tickets.clear();
    this.updateActiveConnectionsMetric();
  }
}

export const sseBroker = new SseBrokerService();
